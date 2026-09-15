import { RpcStub, RpcTarget } from 'cloudflare:workers'
import type { AccountStorage, MnemosAccountSession } from './account-session'
import { BLUEPRINT_TEMPLATE_MIME, MAX_BLUEPRINT_TEMPLATE_BYTES } from '@gadgets/workshop-shared/blueprint-template'
import type { WorkTemplateVersion } from './work-templates'

type Capture = { id: string; project: string; title: string; purpose: string; head: string; upload: string; version?: WorkTemplateVersion; promotion?: {scope: string; revision: number} }
/** Хранилище принадлежит подключению пользователя. Чужой receipt не даёт доступа к операции. */
export class BlueprintTemplates extends RpcTarget {
  constructor(private session: MnemosAccountSession, private storage: AccountStorage) { super() }
  async projects() { return this.session.listProjects() }
  async scopes(cursor = '') { return this.session.listTemplateScopes(cursor) }
  async templates(scope: string, cursor = '') { return this.session.listScopedWorkTemplates(scope, cursor) }
  async apply(scope: string, template: string, revision: number, project: string, name: string, operation: string) {
    if (!/^[a-f0-9-]{36}$/.test(operation)) throw new Error('Некорректная операция')
    const key = `blueprint-application:${operation}`
    const input = {scope, template, revision, project, name}
    let saved = this.storage.get<{input: typeof input; action: string; document?: {node_id: string; head: string}}>(key)
    if (saved && JSON.stringify(saved.input) !== JSON.stringify(input)) throw new Error('Операция уже относится к другому шаблону')
    if (!saved) {
      const {head} = await this.session.openDraft(project)
      const previous = await this.session.readSavedTemplateAction(project)
      const action = await this.session.saveTemplateAction(project, {kind:'create', template, scope,
        input:{request_id:operation, revision, project_id:project, parent_id:'', name, expected_head:head, message:'Рабочая копия общего шаблона'}}, previous?.id ?? '')
      saved = {input, action:action.id}
      this.storage.put(key, saved)
    }
    let document = saved.document
    if (!document) {
      const result = await this.session.executeSavedTemplateAction(project, saved.action)
      if (result.receipt?.kind !== 'create') throw new Error('Создание копии не подтверждено')
      document = result.receipt.document
      this.storage.put(key, {...saved, document})
    }
    const ticket = await this.session.downloadPrivateVersion(project, document.node_id, document.head)
    if (ticket.content_type !== BLUEPRINT_TEMPLATE_MIME) throw new Error('Этот шаблон не является гаджетом')
    return {ticket, node:document.node_id, head:document.head}
  }
  async validateApplication(project: string, node: string, head: string) {
    await this.session.checkPrivateVersionRead(project, node, head)
  }
  async prepare(project: string, title: string, purpose: string) {
    if (!title.trim() || title.length > 200 || !purpose.trim() || purpose.length > 2000) throw new Error('Укажите название и назначение шаблона')
    const { head } = await this.session.openDraft(project)
    const capture: Capture = { id: crypto.randomUUID(), project, title, purpose, head, upload: '' }
    this.storage.put(`blueprint-template:${capture.id}`, capture)
    return { id: capture.id, creator: new RpcStub(new BlueprintTemplateCreator(this.session, this.storage, capture.id)) }
  }
  async resume(id: string) {
    if (!this.storage.get<Capture>(`blueprint-template:${id}`)) throw new Error('Сохранение шаблона не найдено')
    return new RpcStub(new BlueprintTemplateCreator(this.session, this.storage, id))
  }
}

class BlueprintTemplateCreator extends RpcTarget {
  private issued = new Set<string>()
  constructor(private session: MnemosAccountSession, private storage: AccountStorage, private id: string) { super() }
  private read() {
    const capture = this.storage.get<Capture>(`blueprint-template:${this.id}`)
    if (!capture) throw new Error('Сохранение шаблона не найдено')
    return capture
  }
  async state() { const capture = this.read(); return { upload: capture.upload, project: capture.project, title: capture.title, purpose: capture.purpose, version: capture.version ?? null } }
  async issue(size: number, checksum: string) {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BLUEPRINT_TEMPLATE_BYTES) throw new Error("Снимок шаблона слишком большой")
    if (this.read().upload || this.issued.size >= 4) throw new Error('Загрузка уже зафиксирована')
    const ticket = await this.session.beginProjectUpload(this.read().project, size, checksum)
    this.issued.add(ticket.upload_id)
    return ticket
  }
  async checkpoint(upload: string) {
    const capture = this.read()
    if (capture.upload && capture.upload !== upload) throw new Error('Загруженная версия уже зафиксирована')
    if (!capture.upload && !this.issued.has(upload)) throw new Error('Загрузка не принадлежит операции')
    this.storage.put(`blueprint-template:${this.id}`, { ...capture, upload })
  }
  async propose(scope: string, scopeRevision: number) {
    const capture = this.read()
    if (!capture.version) throw new Error('Сначала сохраните версию шаблона')
    if (capture.promotion && (capture.promotion.scope !== scope || capture.promotion.revision !== scopeRevision)) throw new Error('Предложение уже связано с другой областью')
    const version = await this.session.readWorkTemplate(capture.id, capture.version.revision)
    const input = {project_id: capture.project, request_id: capture.id, revision: version.revision,
      target_scope_id: scope, target_scope_revision: scopeRevision, template_key: capture.id,
      expected_catalogue_revision: 0, message: capture.purpose}
    const previous = await this.session.readSavedTemplateAction(capture.project)
    const action = await this.session.saveTemplateAction(capture.project, {kind: 'propose', template: capture.id, input}, previous?.id ?? '')
    this.storage.put(`blueprint-template:${this.id}`, {...capture, promotion: {scope, revision: scopeRevision}})
    const result = await this.session.executeSavedTemplateAction(capture.project, action.id)
    if (result.receipt?.kind !== 'propose') throw new Error('Предложение не подтверждено')
    return result.receipt.proposal
  }
  async save(): Promise<WorkTemplateVersion> {
    const capture = this.read()
    if (!capture.upload) throw new Error('Сначала загрузите снимок шаблона')
    // Повтор проходит через API: сохранённый receipt не заменяет актуальную проверку доступа.
    if (capture.version) return this.session.readWorkTemplate(capture.id, capture.version.revision)
    const created = await this.session.createPrivateDocument(capture.project, {
      request_id: capture.id, expected_head: capture.head, parent_id: '', name: `${capture.title}.mnemos-template`,
      content_type: BLUEPRINT_TEMPLATE_MIME, upload_id: capture.upload, message: 'Снимок Blueprint для согласования',
    })
    const version = await this.session.saveWorkTemplateSnapshot(capture.id, {
      expected_revision: 0, title: capture.title, purpose: capture.purpose, kind: 'document',
      project_id: capture.project, node_id: created.node_id, source_head: created.head,
    })
    this.storage.put(`blueprint-template:${this.id}`, { ...capture, version })
    return version
  }
}
