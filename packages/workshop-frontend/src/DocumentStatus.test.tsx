// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { PublicationReview } from '@gadgets/workshop-shared/publication-review'
import DocumentStatus, { DocumentStatusView, deriveDocumentStatus, type StatusInput } from './DocumentStatus'

const { api } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<Disposable>>(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return { [Symbol.dispose]() {} } }) } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

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
  ['2 сохранено', {}, { kind: 'saved', version: 'Личная версия от v12', audience: 'видят вы и Мария', saved: 'сохранено 4 мин назад', primary: 'На согласование' }],
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
    expect(button('Версия')).toBeDefined()
    const primary = host.querySelector('button[data-primary-action]') as HTMLButtonElement | null
    expect(primary?.textContent ?? null).toBe(want.primary)
    const secondary = want.secondary ? button(want.secondary) : undefined
    expect(secondary !== undefined).toBe(want.secondary !== undefined)
    await act(async () => { primary?.click(); secondary?.click(); button('Версия')!.click() })
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
type Faults = { select?: boolean; participants?: boolean; publications?: boolean; snapshot?: boolean }
const head = 'a'.repeat(64)

function frame(faults: Faults) {
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: head, shared_head: 'b'.repeat(64), personal_exists: true } }
    async select() { if (faults.select) throw new Error('Not found'); return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async participants() {
      if (faults.participants) throw new Error('Forbidden')
      return { head, nextCursor: '', participants: [{ id: 'maria', name: 'Мария', mode: 'read', canRead: true, canWrite: false }] }
    }
    async reviewerIdentity() { return 'owner' }
  }
  class Downloads extends RpcTarget {
    async publications() {
      if (faults.publications) throw new Error('Not found')
      return { resourceUrl: 'https://objects.example/doc', nextCursor: '', publications: [
        { id: 'private:' + 'd'.repeat(64), recordedAt: new Date(Date.now() - 4 * 60_000).toISOString(), actor: '', format: 'cloudflareos.document' },
        { id: 'event-1', recordedAt: '2026-09-02T10:00:00Z', actor: 'Анна', format: 'cloudflareos.document' },
      ] }
    }
  }
  class Empty extends RpcTarget {}
  return { iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }
}

async function mountStatus({ faults = {}, savedRevision, revision, pollMs }: { faults?: Faults; savedRevision?: number; revision: { current: number }; pollMs?: number }) {
  api.getGatekeeperApp.mockImplementation(async () => frame(faults))
  class Gadget extends RpcTarget { async getId() { return 'native-doc' } }
  const gadget = new RpcStub(new Gadget())
  sessionStorage.setItem('mnemos-native-binding:/:native-doc:cloudflareos.document', JSON.stringify({ accountId: null, scope: 'project', resource: 'doc', savedRevision }))
  const snapshotSource = { current: async () => {
    if (faults.snapshot) throw new Error('Editor snapshot unavailable.')
    return { format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: revision.current, title: 'План', blocks: [] } }
  } }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} changesPollMs={pollMs} />))
  const status = () => container.querySelector('[data-document-status]')!
  const primary = () => container.querySelector('button[data-primary-action]')
  const settled = async () => { await act(async () => { await vi.waitFor(() => expect(status().textContent).not.toContain('Читаю состояние')) }) }
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]() }
  return { status, primary, settled, unmount }
}

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
    expect(view.primary()?.textContent).toBe('На согласование')
    revision.current = 9
    // Опрос идёт по таймеру вне act: обновления из него доходят до DOM только после отдельного сброса act.
    await vi.waitFor(async () => { await act(async () => {}); expect(view.status().textContent).toContain('не сохранено · 2 изменения') }, { timeout: 2_000 })
    expect(view.primary()?.textContent).toBe('Сохранить')
  } finally { await view.unmount() }
})
