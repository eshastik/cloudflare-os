// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { PublicationReview } from '@gadgets/workshop-shared/publication-review'
import { historyPreparingMessage } from '../../gatekeeper-mnemos/src/history-preparing.ts'
import DocumentStatus, { DocumentStatusView, deriveDocumentStatus, publishDeniedMessage, useDocumentStatus, type StatusInput } from './DocumentStatus'

const { api } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<Disposable>>(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return { [Symbol.dispose]() {} } }) } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
// Выгрузка тела в хранилище проверяется в своих тестах; здесь важна версия, от которой сохраняют.
vi.mock('./gatekeeperAppUpload', () => ({ uploadGatekeeperNativeDocument: async () => 'upload-1' }))
// Скачивание версии: билет несёт идентификатор версии, содержимое задаёт тест.
const { contents } = vi.hoisted(() => ({ contents: new Map<string, string>() }))
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperNativeDocument: async (_origin: string, ticket: { id: string }) => {
  const text = contents.get(ticket.id)
  if (text === undefined) throw new Error('Версия не найдена')
  return { format: 'cloudflareos.document', formatVersion: 1, document: { title: 'План', blocks: [{ type: 'paragraph', text }] } }
} }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); contents.clear(); vi.restoreAllMocks() })

const now = Date.parse('2026-09-13T12:00:00Z')
const review = (over: Partial<PublicationReview> & { domains?: PublicationReview['domains'] }): PublicationReview => ({
  candidate_id: 'proposal', project_id: 'project', author_id: 'owner', personal_head: 'a', shared_head: 'b',
  decision_version: 1, stale: false, ready: false,
  domains: [
    { domain_id: 'Дизайн', node_ids: ['doc'], approvers: ['maria'], decisions: [{ approver_id: 'maria', approved: true }] },
    { domain_id: 'Разработка', node_ids: ['doc'], approvers: ['ivan'], decisions: [] },
  ],
  ...over,
})
const base: StatusInput = {
  personalExists: true, conflict: false, invited: ['Мария'], review: null, sharedVersion: 'v12',
  savedAt: new Date(now - 4 * 60_000).toISOString(), changes: 0, now,
}

// Восемь состояний шапки: что в блоке состояния и какая кнопка главная.
const table: [string, Partial<StatusInput>, { kind: string; version: string; audience: string; saved: string; primary: string | null; secondary?: string }][] = [
  ['1 не сохранено', { changes: 2 }, { kind: 'unsaved', version: 'Личная версия от v12', audience: 'видят вы и Мария', saved: 'не сохранено · 2 изменения', primary: 'Сохранить' }],
  ['2 сохранено', {}, { kind: 'saved', version: 'Личная версия от v12', audience: 'видят вы и Мария', saved: 'сохранено 4 мин назад', primary: 'Опубликовать' }],
  ['3 на согласовании', { review: review({}), invited: ['Мария', 'Иван'] }, { kind: 'reviewing', version: 'Кандидат от v12', audience: 'видят вы, Мария, Иван', saved: 'Дизайн: одобрено · Разработка: ждёт', primary: null, secondary: 'Отозвать' }],
  ['4 отказ', { review: review({ domains: [{ domain_id: 'Разработка', node_ids: ['doc'], approvers: ['ivan'], decisions: [{ approver_id: 'ivan', approved: false, comment: 'сроки не бьются со спринтом' } as PublicationReview['domains'][number]['decisions'][number]] }] }) }, { kind: 'rejected', version: 'Кандидат от v12', audience: 'видят вы и Мария', saved: 'Разработка: отказ — «сроки не бьются со спринтом»', primary: 'Доработать' }],
  ['5 конфликт', { conflict: true }, { kind: 'conflict', version: 'Личная версия от v12', audience: 'видят вы и Мария', saved: 'опубликована v12 · есть конфликт', primary: 'Разрешить конфликт' }],
  ['6 устарело', { review: review({ stale: true }) }, { kind: 'stale', version: 'Личная версия от v12', audience: 'видят вы и Мария', saved: 'текст изменён после отправки · решения сброшены', primary: 'Отправить заново' }],
  ['7 все решения', { review: review({ ready: true, domains: [{ domain_id: 'Дизайн', node_ids: ['doc'], approvers: ['maria'], decisions: [{ approver_id: 'maria', approved: true }] }, { domain_id: 'Разработка', node_ids: ['doc'], approvers: ['ivan'], decisions: [{ approver_id: 'ivan', approved: true }] }] }) }, { kind: 'ready', version: 'Кандидат от v12', audience: 'видят вы и Мария', saved: 'одобрено: Дизайн, Разработка', primary: 'Опубликовать' }],
  ['8 опубликованная', { personalExists: false, invited: [] }, { kind: 'published', version: 'Опубликована v12', audience: 'видят все участники проекта', saved: 'без изменений', primary: 'Начать личную версию' }],
]

it.each(table)('состояние %s: блок состояния и главное действие', async (_name, input, want) => {
  const model = deriveDocumentStatus({ ...base, ...input })
  expect(model.kind).toBe(want.kind)
  expect([model.version, model.audience, model.saved]).toEqual([want.version, want.audience, want.saved])
  expect(model.primary?.label ?? null).toBe(want.primary)
  expect(model.secondary?.label).toBe(want.secondary)
  const onPrimary = vi.fn<(kind: string) => void>(), onSecondary = vi.fn<() => void>(), onOpenVersion = vi.fn<() => void>()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
  try {
    await act(async () => { root.render(<DocumentStatusView model={model} onPrimary={onPrimary} onSecondary={onSecondary} onOpenVersion={onOpenVersion} versionOpen={false} />) })
    const status = host.querySelector('[data-document-status]')!
    expect(status.textContent).toContain(want.version)
    expect(status.textContent).toContain(want.audience)
    expect(status.textContent).toContain(want.saved)
    expect(button('Версии')).toBeDefined()
    const primary = host.querySelector('button[data-primary-action]') as HTMLButtonElement | null
    expect(primary?.textContent ?? null).toBe(want.primary)
    const secondary = want.secondary ? button(want.secondary) : undefined
    expect(secondary !== undefined).toBe(want.secondary !== undefined)
    await act(async () => { primary?.click(); secondary?.click(); button('Версии')!.click() })
    expect(onPrimary.mock.calls).toEqual(want.primary ? [[model.primary!.kind]] : [])
    expect(onSecondary).toHaveBeenCalledTimes(want.secondary ? 1 : 0)
    expect(onOpenVersion).toHaveBeenCalledOnce()
  } finally { await act(async () => { root.unmount() }); host.remove() }
})

it('«только вы» показывается лишь без приглашённых, подсказка отправки перечисляет, что уйдёт', () => {
  expect(deriveDocumentStatus({ ...base, invited: [] }).audience).toBe('только вы')
  expect(deriveDocumentStatus({ ...base, invited: ['Мария'] }).audience).not.toContain('только вы')
  const hint = deriveDocumentStatus(base).primary!.hint!
  for (const part of ['имя', 'папк', 'текст', 'направлени']) expect(hint.toLowerCase()).toContain(part)
  expect(deriveDocumentStatus({ ...base, changes: 'no-baseline' }).saved).toContain('сверить не с чем')
  expect(deriveDocumentStatus({ ...base, changes: 'unread' }).primary).toBeNull()
  expect(deriveDocumentStatus({ ...base, conflict: null }).primary).toBeNull()
  expect(deriveDocumentStatus({ ...base, invited: null }).audience).toBe('кто видит — не прочитано')
  expect(deriveDocumentStatus({ ...base, savedAt: null }).saved).toBe('сохранено')
})

// Живой хук с заглушками RPC: отказ каждого запроса и ревизия редактора задаются на вход.
type Faults = {
  /** История проекта готовится на сервере: черновик и состояние отвечают 429 history_preparing с этим ходом. */
  preparing?: () => { done: number; total: number } | null
  select?: boolean; participants?: boolean; publications?: boolean; snapshot?: boolean; publish?: 'denied' | 'published'; published?: string[]
  /** История документа вместо стандартной; функция — перечитывается при каждом запросе. */
  history?: () => { id: string; recordedAt: string; actor: string; format: 'cloudflareos.document' }[] }
const head = 'a'.repeat(64)

function frame(faults: Faults) {
  // Так ошибку отдаёт мост Mnemos: через RPC доходит только текст с меткой хода.
  const preparing = () => { const progress = faults.preparing?.(); if (progress) throw new Error(historyPreparingMessage(progress)) }
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async publicationState() { preparing(); return { personal_head: head, shared_head: 'b'.repeat(64), personal_exists: true } }
    async select() { preparing(); if (faults.select) throw new Error('Not found'); return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async participants() {
      if (faults.participants) throw new Error('Forbidden')
      return { head, nextCursor: '', participants: [{ id: 'maria', name: 'Мария', mode: 'read', canRead: true, canWrite: false }] }
    }
    async reviewerIdentity() { return 'owner' }
  }
  // «Опубликовать» с ответом сервера: нет права записи либо публикация сразу (согласования в проекте нет).
  class PublishingSelector extends Selector {
    async publishOrRequestReview(scope: string, personal: string, shared: string) {
      faults.published?.push(`${scope}:${personal}:${shared}`)
      return faults.publish === 'denied' ? { status: 'denied' } : { status: 'published', personal_head: personal, shared_head: 'c'.repeat(64) }
    }
    async scopes() { return { scopes: [{ id: 'project', name: 'Mnemos' }] } }
    async documentLocation() { return { head, name: 'Последние коммиты', parent: 'folder-1' } }
    async folders() { return { folders: [{ id: 'folder-1', name: 'Презентации', parent: '' }], nextCursor: '' } }
  }
  class Download extends RpcTarget {
    constructor(readonly id: string) { super() }
    async issue() { return { id: this.id } }
    async validate() {}
  }
  class Downloads extends RpcTarget {
    async select(_scope: string, _resource: string, id: string) { return new RpcStub(new Download(id)) }
    async publications() {
      if (faults.publications) throw new Error('Not found')
      if (faults.history) return { resourceUrl: 'https://objects.example/doc', nextCursor: '', publications: faults.history() }
      return { resourceUrl: 'https://objects.example/doc', nextCursor: '', publications: [
        { id: 'private:' + 'd'.repeat(64), recordedAt: new Date(Date.now() - 4 * 60_000).toISOString(), actor: '', format: 'cloudflareos.document' },
        { id: 'event-1', recordedAt: '2026-09-02T10:00:00Z', actor: 'Анна', format: 'cloudflareos.document' },
      ] }
    }
  }
  class Empty extends RpcTarget {}
  return { iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(faults.publish ? new PublishingSelector() : new Selector()) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }
}

async function mountStatus({ faults = {}, savedRevision, revision, pollMs, flashMs, historyPollMs }: { faults?: Faults; savedRevision?: number; revision: { current: number }; pollMs?: number; flashMs?: number; historyPollMs?: number }) {
  api.getGatekeeperApp.mockImplementation(async () => frame(faults))
  class Gadget extends RpcTarget { async getId() { return 'native-doc' } }
  const gadget = new RpcStub(new Gadget())
  sessionStorage.setItem('mnemos-native-binding:/:native-doc:cloudflareos.document', JSON.stringify({ accountId: null, scope: 'project', resource: 'doc', savedRevision }))
  const snapshotSource = { current: async () => {
    if (faults.snapshot) throw new Error('Редактор не отдал документ.')
    return { format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: revision.current, title: 'План', blocks: [] } }
  } }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} changesPollMs={pollMs} flashMs={flashMs} historyPollMs={historyPollMs} />))
  const status = () => container.querySelector('[data-document-status]')!
  const primary = () => container.querySelector('button[data-primary-action]')
  const settled = async () => { await act(async () => { await vi.waitFor(() => expect(status().textContent).not.toContain('Читаю состояние')) }) }
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]() }
  return { status, primary, settled, unmount, container }
}

it('история проекта готовится: спокойная строка с ходом без красной ошибки, опрос до готовности', async () => {
  let progress: { done: number; total: number } | null = { done: 120, total: 3670 }
  const view = await mountStatus({ faults: { preparing: () => progress }, savedRevision: 7, revision: { current: 7 }, historyPollMs: 30 })
  // Обновления внутри act применяются по его завершении: каждая проверка отпускает act.
  const until = (check: () => void) => vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }); check() }, { timeout: 3000 })
  try {
    await until(() => expect(view.status().textContent).toBe('История проекта готовится: перенесено 120 из 3 670 файлов'))
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
    expect(view.container.querySelector('[data-history-preparing] [role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('3')
    expect(view.primary()).toBeNull()
    // Опрос идёт сам: ход обновляется без нажатий.
    const asked = api.getGatekeeperApp.mock.calls.length
    progress = { done: 3000, total: 3670 }
    await until(() => expect(view.status().textContent).toContain('перенесено 3 000 из 3 670'))
    expect(api.getGatekeeperApp.mock.calls.length).toBeGreaterThan(asked)
    // Перенос закончен: шапка показывает обычное состояние документа и больше не опрашивает.
    progress = null
    await until(() => expect(view.primary()?.textContent).toBe('Опубликовать'))
    expect(view.container.querySelector('[data-history-preparing]')).toBeNull()
    const settledCalls = api.getGatekeeperApp.mock.calls.length
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
    expect(api.getGatekeeperApp.mock.calls.length).toBe(settledCalls)
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  } finally { await view.unmount() }
})

// Дефект 2026-09-24: «Опубликовать» при отказе сервера (403) молчало — ошибка жила только в закрытой панели.
it('отказ «Опубликовать» в праве: строка рядом с кнопкой называет папку, проект и к кому идти', async () => {
  const published: string[] = []
  const view = await mountStatus({ faults: { publish: 'denied', published }, savedRevision: 7, revision: { current: 7 } })
  try {
    await view.settled()
    expect(view.primary()?.textContent).toBe('Опубликовать')
    await act(async () => { (view.primary() as HTMLButtonElement).click() })
    await act(async () => { await vi.waitFor(() => expect(view.container.querySelector('[role="alert"]')).not.toBeNull()) })
    expect(published).toEqual([`project:${head}:${'b'.repeat(64)}`])
    expect(view.container.querySelector('[role="alert"]')!.textContent).toBe('Публикация не прошла: нет права записи в папку «Презентации» проекта «Mnemos». Попросите владельца проекта или администратора открыть вам правку.')
  } finally { await view.unmount() }
})

it('«Опубликовать» в проекте без согласования публикует сразу и говорит об этом', async () => {
  const published: string[] = []
  const view = await mountStatus({ faults: { publish: 'published', published }, savedRevision: 7, revision: { current: 7 } })
  try {
    await view.settled()
    await act(async () => { (view.primary() as HTMLButtonElement).click() })
    await act(async () => { await vi.waitFor(() => expect(published).toHaveLength(1)) })
    await view.settled()
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  } finally { await view.unmount() }
})

// Дефект 2026-09-24 (выпуск d0d63ed0): публикация проходила, но шапка и после перезагрузки писала
// «Черновик · Личная версия от v1» с активной «Опубликовать» — личная ветка после публикации остаётся.
const privateId = 'private:' + 'd'.repeat(64)
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

it('после «Опубликовать» шапка подтверждает публикацию в проект и показывает «Опубликовано», кнопка неактивна', async () => {
  const published: string[] = []
  contents.set(privateId, 'Последние коммиты').set('event-2', 'Последние коммиты')
  const history = () => [
    { id: privateId, recordedAt: minutesAgo(60), actor: '', format: 'cloudflareos.document' as const },
    // Опубликованная версия появляется в истории только после публикации.
    ...published.length ? [{ id: 'event-2', recordedAt: minutesAgo(0), actor: 'Владелец', format: 'cloudflareos.document' as const }] : [],
  ]
  const view = await mountStatus({ faults: { publish: 'published', published, history }, savedRevision: 7, revision: { current: 7 }, flashMs: 200 })
  try {
    await view.settled()
    expect(view.status().textContent).toContain('Личная версия')
    expect((view.primary() as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { (view.primary() as HTMLButtonElement).click() })
    await act(async () => { await vi.waitFor(() => expect(view.container.querySelector('[data-document-status] [role="status"]')?.textContent).toBe('Опубликовано в проект «Mnemos»')) })
    await vi.waitFor(async () => { await act(async () => {}); expect(view.status().textContent).toContain('Опубликовано · совпадает с опубликованной версией') }, { timeout: 2_000 })
    expect(view.status().textContent).not.toContain('Личная версия')
    expect(view.primary()?.textContent).toBe('Опубликовать')
    expect((view.primary() as HTMLButtonElement).disabled).toBe(true)
  } finally { await view.unmount() }
})

it('повторное открытие опубликованного документа без новых правок: «Опубликовано», не черновик', async () => {
  contents.set(privateId, 'Последние коммиты').set('event-2', 'Последние коммиты')
  const history = () => [
    { id: privateId, recordedAt: minutesAgo(60), actor: '', format: 'cloudflareos.document' as const },
    { id: 'event-2', recordedAt: minutesAgo(30), actor: 'Владелец', format: 'cloudflareos.document' as const },
  ]
  const view = await mountStatus({ faults: { history }, savedRevision: 7, revision: { current: 7 } })
  try {
    await view.settled()
    await vi.waitFor(async () => { await act(async () => {}); expect(view.status().textContent).toContain('Опубликовано · совпадает с опубликованной версией') }, { timeout: 2_000 })
    expect(view.status().textContent).toContain('Опубликована v1')
    expect((view.primary() as HTMLButtonElement).disabled).toBe(true)
  } finally { await view.unmount() }
})

it.each([
  ['сохранение после публикации', 'Последние коммиты', 10, 30],
  ['более поздняя публикация коллеги с другим текстом', 'Текст коллеги', 30, 5],
] as const)('личная версия не совпадает с опубликованной (%s): черновик и активная «Опубликовать»', async (_name, sharedText, ownAgo, sharedAgo) => {
  contents.set(privateId, 'Последние коммиты').set('event-2', sharedText)
  const history = () => [
    { id: privateId, recordedAt: minutesAgo(ownAgo), actor: '', format: 'cloudflareos.document' as const },
    { id: 'event-2', recordedAt: minutesAgo(sharedAgo), actor: 'Коллега', format: 'cloudflareos.document' as const },
  ]
  const view = await mountStatus({ faults: { history }, savedRevision: 7, revision: { current: 7 } })
  try {
    await view.settled()
    await vi.waitFor(async () => { await act(async () => {}); expect(view.status().textContent).toContain('Личная версия от v1') }, { timeout: 2_000 })
    expect(view.status().textContent).not.toContain('Опубликовано')
    expect((view.primary() as HTMLButtonElement).disabled).toBe(false)
  } finally { await view.unmount() }
})

it('сообщение об отказе без имени папки называет проект', () => {
  expect(publishDeniedMessage('Mnemos', null)).toBe('Публикация не прошла: нет права записи в проект «Mnemos». Попросите владельца проекта или администратора открыть вам правку.')
  expect(publishDeniedMessage(null, null)).toContain('в этот проект')
})

it('(а) отказ participants: блок «кто видит» — «не прочитано», а не «только вы»', async () => {
  const view = await mountStatus({ faults: { participants: true }, savedRevision: 7, revision: { current: 7 } })
  try {
    await view.settled()
    expect(view.status().textContent).toContain('не прочитано')
    expect(view.status().textContent).not.toContain('только вы')
  } finally { await view.unmount() }
})

it('(б) отказ select и publications: состояние «не прочитано», главной кнопки нет, шапка не говорит «не привязан»', async () => {
  const view = await mountStatus({ faults: { select: true, publications: true }, savedRevision: 7, revision: { current: 7 } })
  try {
    await view.settled()
    expect(view.status().textContent).toContain('не прочитан')
    expect(view.status().textContent).not.toContain('сохранено')
    expect(view.status().textContent).not.toContain('не привязан')
    expect(view.primary()).toBeNull()
  } finally { await view.unmount() }
})

it('(в) привязка без savedRevision при ревизии 40: «сверить не с чем» и главное действие «Сохранить»', async () => {
  const view = await mountStatus({ revision: { current: 40 } })
  try {
    await view.settled()
    expect(view.status().textContent).toContain('сверить не с чем')
    expect(view.status().textContent).not.toContain('сохранено')
    expect(view.primary()?.textContent).toBe('Сохранить')
  } finally { await view.unmount() }
})

it('(г) снимок редактора бросает: «изменения не прочитаны», без «сохранено» и главной кнопки', async () => {
  const view = await mountStatus({ faults: { snapshot: true }, savedRevision: 7, revision: { current: 7 } })
  try {
    await view.settled()
    expect(view.status().textContent).toContain('изменения редактора не прочитаны')
    expect(view.status().textContent).not.toContain('сохранено')
    expect(view.primary()).toBeNull()
  } finally { await view.unmount() }
})

it('(д) ревизия 7 при загрузке, затем 9: статус становится «не сохранено · 2 изменения» без ручного «Перечитать»', async () => {
  const revision = { current: 7 }
  const view = await mountStatus({ savedRevision: 7, revision, pollMs: 20 })
  try {
    await view.settled()
    expect(view.status().textContent).toContain('сохранено 4 мин назад')
    expect(view.primary()?.textContent).toBe('Опубликовать')
    revision.current = 9
    // Опрос идёт по таймеру вне act: обновления из него доходят до DOM только после отдельного сброса act.
    await vi.waitFor(async () => { await act(async () => {}); expect(view.status().textContent).toContain('не сохранено · 2 изменения') }, { timeout: 2_000 })
    expect(view.primary()?.textContent).toBe('Сохранить')
  } finally { await view.unmount() }
})

// Автосохранение: правка уходит в документ сама от версии, с которой работает редактор; если документ
// успел изменить другой человек, сохранение отклоняется явно — чужая правка не затирается.
it.each([['сохранено', false], ['изменил другой участник', true]] as const)('автосохранение: %s', async (_name, changed) => {
  const saves: string[][] = []
  class Writer extends RpcTarget {
    async head() { return 'c'.repeat(64) }
    async issue() { return { upload_id: 'upload-1', url: 'https://objects.example/u', method: 'PUT', headers: {}, expires_at: '' } }
    async save(base: string, upload: string) { saves.push([base, upload]); if (changed) throw new Error('DOCUMENT_CHANGED'); return 'f'.repeat(64) }
  }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: head, shared_head: 'b'.repeat(64), personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async participants() { return { head, nextCursor: '', participants: [] } }
    async reviewerIdentity() { return 'owner' }
  }
  class Downloads extends RpcTarget { async publications() { return { resourceUrl: '', nextCursor: '', publications: [] } } }
  class Empty extends RpcTarget {}
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }))
  class Gadget extends RpcTarget { async getId() { return 'native-doc' } }
  const gadget = new RpcStub(new Gadget())
  const key = 'mnemos-native-binding:/:native-doc:cloudflareos.document'
  sessionStorage.setItem(key, JSON.stringify({ accountId: null, scope: 'project', resource: 'doc', savedRevision: 7, savedHead: head }))
  const snapshotSource = { current: async () => ({ format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: 9, title: 'План', blocks: [] } }) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} changesPollMs={0} autosaveMs={5} />))
    await vi.waitFor(async () => { await act(async () => {}); expect(saves).toHaveLength(1) }, { timeout: 2_000 })
    // База сохранения — версия, от которой правит редактор, а не текущая голова.
    expect(saves[0]).toEqual([head, 'upload-1'])
    if (changed) {
      await vi.waitFor(async () => { await act(async () => {}); expect(container.querySelector('[data-document-status]')!.textContent).toContain('документ изменил другой участник') }, { timeout: 2_000 })
      expect(container.querySelector('button[data-primary-action]')?.textContent).toBe('Открыть новую версию')
      expect(JSON.parse(sessionStorage.getItem(key)!).savedHead).toBe(head)
    } else {
      await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ savedHead: 'f'.repeat(64), savedRevision: 9 }), { timeout: 2_000 })
    }
  } finally { await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]() }
})

// Общий документ по приглашению (mode=write). Снимок редактора, как настоящий, приходит не сразу и
// обрывается сигналом: так видна гонка, при которой ревизия после открытия не записывалась в привязку.
function sharedHarness({ saveFails = false, binding }: { saveFails?: boolean; binding?: Record<string, unknown> } = {}) {
  const saves: string[][] = [], serverBindings: unknown[] = []
  const revision = { current: 7 }
  /** Задержка ближайшего чтения снимка, мс: так медленный редактор отдаёт ревизию привязке позже, чем её ждёт опрос. */
  const nextRead = { delayMs: 0 }
  class Writer extends RpcTarget {
    async head() { return 'c'.repeat(64) }
    async access() { return 'write' as const }
    async issue() { return { upload_id: 'upload-1', url: 'https://objects.example/u', method: 'PUT', headers: {}, expires_at: '' } }
    async save(base: string, upload: string) { saves.push([base, upload]); if (saveFails) throw new Error('Forbidden'); return 'f'.repeat(64) }
  }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: head, shared_head: 'b'.repeat(64), personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async participants() { throw new Error('Приглашённому список участников не нужен') }
    async sharedDocuments() { return { documents: [{ scope: 'project', resource: 'doc', name: 'Дорожная карта.docx' }] } }
    async reviewerIdentity() { return 'admin' }
  }
  class Downloads extends RpcTarget {
    async publications() { return { resourceUrl: '', nextCursor: '', publications: [{ id: 'private:' + 'd'.repeat(64), recordedAt: new Date(Date.now() - 60_000).toISOString(), actor: '', format: 'cloudflareos.document' }] } }
  }
  class Empty extends RpcTarget {}
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }))
  class Gadget extends RpcTarget {
    async getId() { return 'native-doc' }
    async getMnemosDocument() { return { binding: binding ?? null, creation: null, project: null } }
    async setMnemosDocument(next: unknown) { serverBindings.push(next) }
    async ensureNativeDocumentTitle() { return 'План' }
  }
  const snapshotSource = { current: (_format: string, signal: AbortSignal) => new Promise<{ format: 'cloudflareos.document'; formatVersion: 1; document: { revision: number; title: string; blocks: never[] } }>((resolve, reject) => {
    const delay = nextRead.delayMs || 20; nextRead.delayMs = 0
    const timer = setTimeout(() => resolve({ format: 'cloudflareos.document', formatVersion: 1, document: { revision: revision.current, title: 'План', blocks: [] } }), delay)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Редактор не отдал документ.')) }, { once: true })
  }) }
  return { saves, serverBindings, revision, nextRead, snapshotSource, gadget: new RpcStub(new Gadget()) }
}

async function mountShared(harness: ReturnType<typeof sharedHarness>) {
  let handle: ReturnType<typeof useDocumentStatus> | null = null
  function Harness() {
    const status = useDocumentStatus({ gadget: harness.gadget as unknown as RpcStub<GadgetClient>, format: 'cloudflareos.document', snapshotSource: harness.snapshotSource as never, changesPollMs: 20, autosaveMs: 5 })
    handle = status
    return <DocumentStatusView model={status.model} bound={!!status.binding} busy={status.busy} versionOpen={false} onPrimary={kind => { if (kind === 'save') void status.saveNow() }} onSecondary={() => {}} onOpenVersion={() => {}} />
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<Harness />))
  await act(async () => { await vi.waitFor(() => expect(handle?.gadgetId).toBe('native-doc')) })
  const text = () => container.querySelector('[data-document-status]')!.textContent ?? ''
  const until = async (check: () => void) => { await vi.waitFor(async () => { await act(async () => {}); check() }, { timeout: 2_000 }) }
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); harness.gadget[Symbol.dispose]() }
  return { handle: () => handle!, text, until, container, unmount }
}

it('общий документ открыт без правок: строка «сохранено», ревизия записана на сервер до перезагрузки, сохранений нет', async () => {
  const harness = sharedHarness()
  const view = await mountShared(harness)
  try {
    // Открытие из «Поделились с вами»: редактор получил документ, шапка привязывается к нему; следом страница перезагружается.
    // Как в браузере: React отрисовывает новую привязку, пока редактор ещё готовит снимок.
    // Медленное устройство: ревизию для привязки редактор отдаёт позже, чем шапка дочитывает состояние и
    // считает правки. Пока привязка не закончилась, документ не считается изменённым и не сохраняется.
    harness.nextRead.delayMs = 300
    let opened: Promise<void> = Promise.resolve()
    await act(async () => { opened = view.handle().bindAtEditorRevision({ accountId: null, scope: 'project', resource: 'doc', savedHead: 'd'.repeat(64) }) })
    await act(async () => { await opened })
    // Перезагрузка берёт привязку с сервера: к её концу ревизия уже должна быть там.
    expect(harness.serverBindings.at(-1)).toMatchObject({ scope: 'project', resource: 'doc', savedRevision: 7, savedHead: 'd'.repeat(64) })
    await view.until(() => expect(view.text()).toContain('сохранено'))
    expect(view.text()).toContain('Общий документ')
    expect(view.text()).not.toContain('сохраняю')
    await new Promise(resolve => setTimeout(resolve, 150))
    await act(async () => {})
    expect(harness.saves).toEqual([])
    expect(view.text()).not.toContain('сохраняю')
  } finally { await view.unmount() }
})

it('правка общего документа при mode=write уходит сохранением от версии владельца, строка доходит до «сохранено»', async () => {
  const harness = sharedHarness({ binding: { accountId: null, scope: 'project', resource: 'doc', savedRevision: 7, savedHead: 'd'.repeat(64) } })
  const view = await mountShared(harness)
  try {
    await view.until(() => expect(view.text()).toContain('сохранено'))
    harness.revision.current = 9
    await view.until(() => expect(harness.saves).toEqual([['d'.repeat(64), 'upload-1']]))
    await view.until(() => { expect(view.text()).toContain('сохранено'); expect(view.text()).not.toContain('не сохранено') })
    expect(harness.serverBindings.at(-1)).toMatchObject({ savedRevision: 9, savedHead: 'f'.repeat(64) })
  } finally { await view.unmount() }
})

it('отказ сохранения общего документа: понятная строка ошибки вместо вечного «сохраняю…», без повторов по кругу', async () => {
  const harness = sharedHarness({ saveFails: true, binding: { accountId: null, scope: 'project', resource: 'doc', savedHead: 'd'.repeat(64) } })
  const view = await mountShared(harness)
  try {
    await view.until(() => expect(harness.saves).toHaveLength(1))
    await view.until(() => expect(view.text()).toContain('не сохранено · Mnemos не принял сохранение'))
    expect(view.text()).not.toContain('сохраняю')
    expect(view.container.querySelector('button[data-primary-action]')?.textContent).toBe('Сохранить')
    await new Promise(resolve => setTimeout(resolve, 150))
    await act(async () => {})
    expect(harness.saves).toHaveLength(1)
  } finally { await view.unmount() }
})
