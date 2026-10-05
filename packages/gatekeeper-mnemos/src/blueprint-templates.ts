import type {TemplateAgentAccessPlan} from './workshop-template-access.ts';
import {templateReviewAccess,shareTemplateForReview} from './template-review-access.ts';
import {checkedTemplateReferences,type WorkTemplateReference,type WorkTemplateKind} from '@gadgets/workshop-shared/work-template'
import { RpcStub, RpcTarget } from 'cloudflare:workers'
import type { AccountStorage, MnemosAccountSession } from './account-session'
import { BLUEPRINT_TEMPLATE_MIME, MAX_BLUEPRINT_TEMPLATE_BYTES } from '@gadgets/workshop-shared/blueprint-template'
import { MnemosAPIError } from './mnemos-api'
import type { WorkTemplateVersion } from './work-templates'

type Improvement=Extract<WorkTemplateReference,{scope_id:string}> & {scopeRevision:number}
type Capture = { improvement?:Improvement; kind?: WorkTemplateKind; nativeFormat?: "cloudflareos.document"; blueprint?: string; template?: string; expectedRevision?: number; id: string; project: string; title: string; purpose: string; head: string; upload: string; version?: WorkTemplateVersion; promotion?: {scope: string; revision: number; catalogueRevision?: number; message?:string; accessKey?:string} }
/** Хранилище принадлежит подключению пользователя. Чужой receipt не даёт доступа к операции. */
export class BlueprintTemplates extends RpcTarget {
  constructor(private session: MnemosAccountSession, private storage: AccountStorage,private agentAccessCalls?:{read(references:WorkTemplateReference[]):Promise<TemplateAgentAccessPlan>;allow(references:WorkTemplateReference[],scope:string,binding:string,revision:number):Promise<TemplateAgentAccessPlan>}) { super() }
  async agentAccess(references:WorkTemplateReference[]){if(!this.agentAccessCalls)throw Error('Проверка доступа агента недоступна');return this.agentAccessCalls.read(checkedTemplateReferences(references));}
  async allowAgentAccess(references:WorkTemplateReference[],scope:string,binding:string,revision:number){if(!this.agentAccessCalls)throw Error('Проверка доступа агента недоступна');return this.agentAccessCalls.allow(checkedTemplateReferences(references),scope,binding,revision);}
  async preview(reference:WorkTemplateReference){
    const ref=checkedTemplateReferences([reference])[0]
    const issued=await this.session.beginWorkTemplateDownload(ref),source=issued.source,ticket=issued.ticket
    if(ticket.size_bytes>1024*1024||Date.parse(ticket.expires_at)<=Date.now())throw new Error('Просмотр доступен для снимков до одного МиБ')
    if(!['text/plain','text/markdown','application/vnd.cloudflareos.document+json'].includes(source.content_type))throw new Error('Просмотр этого формата пока не поддерживается')
    let improvement: {scope_id:string;revision:number;name:string}|undefined
    let promotion:{scope_id:string;revision:number;name:string;level:'department'|'organization'}|undefined
    if('scope_id' in ref){
      const scopes:Awaited<ReturnType<MnemosAccountSession['listTemplateScopes']>>['scopes']=[];let cursor=''
      do{const page=await this.session.listTemplateScopes(cursor);scopes.push(...page.scopes);cursor=page.next_cursor||''}while(cursor)
      const scope=scopes.find(item=>item.scope_id===ref.scope_id&&item.enabled)
      if(scope?.level==='group')improvement={scope_id:scope.scope_id,revision:scope.revision,name:scope.name}
      const parent=scopes.find(item=>item.scope_id===scope?.parent_id&&item.enabled)
      if(parent&&(parent.level==='department'||parent.level==='organization'))promotion={scope_id:parent.scope_id,revision:parent.revision,name:parent.name,level:parent.level}
    }
    return {material:{reference:ref,title:source.title,purpose:source.purpose,kind:source.kind},improvement,promotion,sourceHead:source.source_head,
      ticket:{url:ticket.url,method:ticket.method,size_bytes:ticket.size_bytes,sha256_hex:ticket.sha256_hex,content_type:source.content_type}}
  }
  async validatePreview(reference:WorkTemplateReference,sourceHead:string){
    const ref=checkedTemplateReferences([reference])[0]
    if(!/^[a-f0-9]{64}$/.test(sourceHead))throw new Error('Некорректный снимок')
    const material=(await this.session.readWorkTemplateSelection([ref])).materials[0]
    if((material.personal??material.scoped!.source).source_head!==sourceHead)throw new Error('Снимок шаблона изменился')
  }
  async configuration() {
    const scopes = []; let cursor = ''
    do { const page = await this.session.listManagedTemplateScopes(cursor); scopes.push(...page.scopes); cursor=page.next_cursor||'' } while(cursor)
    const people = await this.session.listPeople()
    const groups = []; cursor = ''
    do { const page = await this.session.listOrganizationRoles(cursor); groups.push(...page.roles.filter(item=>item.active&&item.kind==='group'));cursor=page.next_cursor||'' } while(cursor)
    return {scopes, people:people.users.filter(item=>item.active!==false).map(item=>({id:item.userName,name:item.displayName||item.userName})), groups:groups.map(item=>({id:item.id,name:item.name}))}
  }
  async configure(id: string, expected: number, config: Parameters<MnemosAccountSession['setTemplateScope']>[2]) {
    return this.session.setTemplateScope(id, expected, config)
  }
  async projects() { return this.session.listProjects() }
  async scopes(cursor = '') { return this.session.listTemplateScopes(cursor) }
  async templates(scope: string, cursor = '') { return this.session.listScopedWorkTemplates(scope, cursor) }
  async promote(scope: string, template: string, revision: number, message: string, operation: string, expectedTarget?:{scope_id:string;revision:number}) {
    if (!/^[a-f0-9-]{36}$/.test(operation)) throw new Error('Некорректная операция')
    const input = {scope, template, revision, message,expectedTarget}
    const key = `blueprint-promotion:${operation}`
    let saved = this.storage.get<{input: typeof input; project: string; action: string}>(key)
    if (saved && JSON.stringify(saved.input) !== JSON.stringify(input)) throw new Error('Операция уже относится к другому предложению')
    if (!saved) {
      const source = await this.session.readScopedWorkTemplate(scope, template, revision)
      const scopes = []; let cursor = ''
      do { const page = await this.session.listTemplateScopes(cursor); scopes.push(...page.scopes); cursor = page.next_cursor || '' } while(cursor)
      const current = scopes.find(item=>item.scope_id === scope && item.enabled)
      const target = scopes.find(item=>item.scope_id === current?.parent_id && item.enabled)
      if (!target) throw new Error('Нет следующего уровня для согласования')
      if(expectedTarget&&(target.scope_id!==expectedTarget.scope_id||target.revision!==expectedTarget.revision))throw Error('Следующий уровень или его правила изменились')
      let expected = 0
      try { expected = (await this.session.readScopedWorkTemplate(target.scope_id, template, 0)).revision }
      catch(error) { if (!(error instanceof MnemosAPIError) || error.status !== 404) throw error }
      const project = source.source.project_id
      const previous = await this.session.readSavedTemplateAction(project)
      const action = await this.session.saveTemplateAction(project, {kind:'propose', template,
        input:{project_id:project,request_id:operation,revision,source_scope_id:scope,target_scope_id:target.scope_id,
          target_scope_revision:target.revision,template_key:template,expected_catalogue_revision:expected,message}}, previous?.id ?? '')
      saved = {input, project, action:action.id};this.storage.put(key,saved)
    }
    const result = await this.session.executeSavedTemplateAction(saved.project, saved.action)
    if(result.receipt?.kind !== 'propose') throw new Error('Предложение не подтверждено')
    // Сохранённая квитанция не заменяет текущую проверку доступа к заявке.
    return this.session.readTemplateProposal(result.receipt.proposal.proposal_id)
  }
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
  async latest(blueprint:string){
    const saved=this.storage.get<{template_id:string}>(`blueprint-template-latest:${blueprint}`)
    if(!saved)return null
    return this.session.readWorkTemplate(saved.template_id,0)
  }
  async prepare(project: string, title: string, purpose: string, previous?: {template_id:string;revision:number}, blueprint?:string, nativeFormat?: "cloudflareos.document", kind: WorkTemplateKind = "document", improvementReference?: WorkTemplateReference) {
    if(nativeFormat!==undefined&&nativeFormat!=="cloudflareos.document")throw new Error("Поддерживается шаблон документа");
    if(!['document','guidance','agent_instructions','skill'].includes(kind)||(!nativeFormat&&kind!=='document'))throw new Error('Выберите поддерживаемый вид шаблона');
    const contentType=nativeFormat ? "application/vnd.cloudflareos.document+json" : BLUEPRINT_TEMPLATE_MIME;
    if (!title.trim() || title.length > 200 || !purpose.trim() || purpose.length > 2000) throw new Error('Укажите название и назначение шаблона')
    if(blueprint!==undefined&&(!blueprint||blueprint.length>256))throw new Error("Некорректный шаблон гаджета")
    if(previous){
      if(!previous.template_id||!Number.isSafeInteger(previous.revision)||previous.revision<1)throw new Error('Некорректная предыдущая версия')
      const version=await this.session.readWorkTemplate(previous.template_id,previous.revision)
      if(version.project_id!==project||version.content_type!==contentType||version.kind!==kind)throw new Error('Версия относится к другому проекту или формату')
    }
    let improvement:Improvement|undefined
    if(improvementReference){
      const ref=checkedTemplateReferences([improvementReference])[0]
      if(typeof ref.scope_id!=='string'||typeof ref.template_key!=='string'||previous||!nativeFormat)throw Error('Выберите общую версию документа')
      const material=(await this.session.readWorkTemplateSelection([ref])).materials[0]
      if(!material.scoped||material.scoped.source.kind!==kind||material.scoped.source.content_type!==contentType)throw Error('Вид или формат исходного шаблона не совпадает')
      let scope:Awaited<ReturnType<MnemosAccountSession['listTemplateScopes']>>['scopes'][number]|undefined,cursor=''
      do{const page=await this.session.listTemplateScopes(cursor);scope??=page.scopes.find(item=>item.scope_id===ref.scope_id&&item.enabled&&item.level==='group');cursor=page.next_cursor||''}while(cursor)
      if(!scope)throw Error('Личную правку сначала согласуют в группе')
      improvement={scope_id:ref.scope_id,template_key:ref.template_key,revision:ref.revision,scopeRevision:scope.revision}
    }
    const { head } = await this.session.openDraft(project)
    const capture: Capture = { id: crypto.randomUUID(), project, title, purpose, head, upload: '', blueprint, nativeFormat, kind, improvement, ...(previous?{template:previous.template_id,expectedRevision:previous.revision}:{}) }
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
  async state() { const capture = this.read(); return { upload: capture.upload, project: capture.project, title: capture.title, purpose: capture.purpose, kind: capture.kind??'document', version: capture.version ?? null } }
  async issue(size: number, checksum: string) {
    if (!Number.isSafeInteger(size) || size < 0 || size > (this.read().nativeFormat ? 1024*1024 : MAX_BLUEPRINT_TEMPLATE_BYTES)) throw new Error("Снимок шаблона слишком большой")
    if (this.read().upload || this.issued.size >= 4) throw new Error('Загрузка уже зафиксирована')
    const ticket = this.read().nativeFormat
      ? await this.session.beginNativeUpload(this.read().project, size, checksum)
      : await this.session.beginProjectUpload(this.read().project, size, checksum)
    this.issued.add(ticket.upload_id)
    return ticket
  }
  async checkpoint(upload: string) {
    const capture = this.read()
    if (capture.upload && capture.upload !== upload) throw new Error('Загруженная версия уже зафиксирована')
    if (!capture.upload && !this.issued.has(upload)) throw new Error('Загрузка не принадлежит операции')
    this.storage.put(`blueprint-template:${this.id}`, { ...capture, upload })
  }
  async reviewAccess(scope:string,scopeRevision:number){
    const capture=this.read();if(!capture.version)throw Error('Сначала сохраните шаблон');
    const version=await this.session.readWorkTemplate(capture.template??capture.id,capture.version.revision);
    const plan=await templateReviewAccess(this.session,version,scope,scopeRevision);
    return {key:plan.key,reviewers:plan.reviewers};
  }
  async shareForReview(scope:string,scopeRevision:number,key:string){
    const capture=this.read();if(!capture.version)throw Error('Сначала сохраните шаблон');
    const version=await this.session.readWorkTemplate(capture.template??capture.id,capture.version.revision);
    return shareTemplateForReview(this.session,version,scope,scopeRevision,key);
  }
  async propose(scope: string, scopeRevision: number, explanation?:string, accessKey?:string) {
    const capture = this.read()
    if (!capture.version) throw new Error('Сначала сохраните версию шаблона')
    const message=explanation?.trim()??capture.purpose
    if(!message||message.length>4096||capture.improvement&&!explanation?.trim())throw Error('Объясните изменения шаблона')
    if(capture.improvement){
      if(scope!==capture.improvement.scope_id||scopeRevision!==capture.improvement.scopeRevision)throw Error('Предложение относится к исходной группе')
      await this.session.readWorkTemplateSelection([{scope_id:capture.improvement.scope_id,template_key:capture.improvement.template_key,revision:capture.improvement.revision}])
    }
    if (capture.promotion && (capture.promotion.scope !== scope || capture.promotion.revision !== scopeRevision || (capture.promotion.message??capture.purpose)!==message)) throw new Error('Предложение уже связано с другой областью')
    const version = await this.session.readWorkTemplate(capture.template??capture.id, capture.version.revision)
    if(capture.promotion?.accessKey!==undefined&&capture.promotion.accessKey!==accessKey)throw Error('Предложение уже связано с прежним составом согласующих');
    const reviewPlan=accessKey===undefined?null:await templateReviewAccess(this.session,version,scope,scopeRevision);
    if(reviewPlan&&(reviewPlan.key!==accessKey||reviewPlan.reviewers.some(p=>!p.canRead)))throw Error('Проверьте доступ согласующих перед отправкой');
    let catalogueRevision=capture.promotion?.catalogueRevision??capture.improvement?.revision??0
    if(!capture.promotion&&!capture.improvement&&capture.expectedRevision){
      try{catalogueRevision=(await this.session.readScopedWorkTemplate(scope,capture.template??capture.id,0)).revision}
      catch(error){if(!(error instanceof MnemosAPIError)||error.status!==404)throw error}
    }
    const input = {project_id: capture.project, request_id: capture.id, revision: version.revision,
      target_scope_id: scope, target_scope_revision: scopeRevision, template_key: capture.improvement?.template_key??capture.template??capture.id,
      expected_catalogue_revision: catalogueRevision, message}
    const previous = await this.session.readSavedTemplateAction(capture.project)
    const action = await this.session.saveTemplateAction(capture.project, {kind: 'propose', template: capture.template??capture.id, input}, previous?.id ?? '')
    this.storage.put(`blueprint-template:${this.id}`, {...capture, promotion: {scope, revision: scopeRevision, catalogueRevision,message,...(accessKey===undefined?{}:{accessKey})}})
    const result = await this.session.executeSavedTemplateAction(capture.project, action.id)
    if (result.receipt?.kind !== 'propose') throw new Error('Предложение не подтверждено')
    if(reviewPlan){
      if(JSON.stringify(result.receipt.proposal.scope_path.map(s=>[s.scope_id,s.revision]))!==JSON.stringify(reviewPlan.path))throw Error('Предложение относится к другим правилам согласования');
      const current=await templateReviewAccess(this.session,version,scope,scopeRevision);if(current.key!==accessKey||current.reviewers.some(p=>!p.canRead))throw Error('Правила или доступ изменились после отправки. Проверьте предложение');
    }
    return result.receipt.proposal
  }
  async save(): Promise<WorkTemplateVersion> {
    const capture = this.read()
    if (!capture.upload) throw new Error('Сначала загрузите снимок шаблона')
    // Повтор проходит через API: сохранённый receipt не заменяет актуальную проверку доступа.
    if (capture.version) return this.session.readWorkTemplate(capture.template??capture.id, capture.version.revision)
    const created = await this.session.createPrivateDocument(capture.project, {
      request_id: capture.id, expected_head: capture.head, parent_id: '', name: `${capture.title}.${capture.nativeFormat ? "mnemos-document" : "mnemos-template"}`,
      content_type: capture.nativeFormat ? "application/vnd.cloudflareos.document+json" : BLUEPRINT_TEMPLATE_MIME, upload_id: capture.upload, message: 'Личный снимок рабочего шаблона',
    })
    const version = await this.session.saveWorkTemplateSnapshot(capture.template??capture.id, {
      expected_revision: capture.expectedRevision??0, title: capture.title, purpose: capture.purpose, kind: capture.kind??'document',
      project_id: capture.project, node_id: created.node_id, source_head: created.head,
    })
    this.storage.put(`blueprint-template:${this.id}`, { ...capture, version })
    if(capture.blueprint)this.storage.put(`blueprint-template-latest:${capture.blueprint}`,{template_id:version.template_id})
    return version
  }
}
