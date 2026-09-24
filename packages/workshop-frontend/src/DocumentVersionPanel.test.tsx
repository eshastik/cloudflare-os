// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import DocumentStatus, { DOCUMENT_BIND_EVENT, DOCUMENT_SHARE_EVENT } from './DocumentStatus'
import { versionAuthor, versionRows } from './DocumentVersionPanel'

const { api, download } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(subscriber: ConnectedAccountsSubscriber) => Promise<unknown>>() }, download: vi.fn<(...args: any[]) => Promise<unknown>>() }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperNativeReview: vi.fn<() => Promise<null>>(), downloadGatekeeperNativeDocument: download }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

const head = 'a'.repeat(64), shared = 'b'.repeat(64)
class Empty extends RpcTarget {}
const accounts = async (subscriber: ConnectedAccountsSubscriber) => { subscriber.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); subscriber.ready(); return new RpcStub(new Empty()) }

function mount(selector: RpcTarget, downloads: RpcTarget, binding: object) {
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(selector) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(downloads) } }))
  api.subscribeConnectedAccounts.mockImplementation(accounts)
  class Gadget extends RpcTarget { async getId() { return 'native-doc' } async getNativeEditorUpdate() { return null } }
  const gadget = new RpcStub(new Gadget())
  const key = 'mnemos-native-binding:/:native-doc:cloudflareos.document'
  sessionStorage.setItem(key, JSON.stringify(binding))
  const snapshotSource = { current: async () => ({ format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: 7, title: 'План запуска', blocks: [] } }) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)
  const click = async (text: string) => { expect(button(text), text).toBeDefined(); expect(button(text)!.disabled).toBe(false); await act(async () => button(text)!.click()) }
  const render = () => act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} changesPollMs={0} />))
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]() }
  return { key, button, click, render, unmount }
}

it('версии: номера от старой к новой, автор одной строкой, агент — по чьей просьбе', () => {
  const rows = versionRows([
    { id: 'event-1', label: 'v1', recordedAt: '2026-08-18T10:00:00Z', actor: 'Павел', personal: false },
    { id: 'private:x', label: '', recordedAt: '2026-09-20T10:00:00Z', actor: '', author: 'Николай Деревцов', personal: true },
    { id: 'event-2', label: 'v2', recordedAt: '2026-09-02T10:00:00Z', actor: 'Агент', onBehalfOf: 'Анна', personal: false },
  ])
  expect(rows.map(r => [r.id, r.number])).toEqual([['private:x', 3], ['event-2', 2], ['event-1', 1]])
  expect(rows.map(versionAuthor)).toEqual(['Николай Деревцов', 'Агент по просьбе: Анна', 'Павел'])
})

it('панель «Версии» по макету: список версий, выбор строкой, «Сравнить N−1 и N», «Вернуть версию», без выпадающих списков и участников', async () => {
  const mine = { candidate_id: 'proposal', project_id: 'project', author_id: 'owner', personal_head: head, shared_head: shared, decision_version: 3, stale: false, ready: false,
    domains: [{ domain_id: 'Разработка', node_ids: ['doc'], approvers: ['ivan'], decisions: [] }] }
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: head, shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async documentLocation() { return { head, name: 'План запуска', parent: '' } }
    async participants() { return { head, nextCursor: '', participants: [{ id: 'ivan', name: 'Иван Петров', mode: '', canRead: true, canWrite: true }] } }
    async review() { return mine }
    async reviewerIdentity() { return 'owner' }
  }
  class Side extends RpcTarget { async issue() { return { url: 'https://objects.example/x', method: 'GET', size_bytes: 1, sha256_hex: 'c'.repeat(64), content_type: 'application/vnd.cloudflareos.document+json' } } async validate() {} }
  const selected: string[] = []
  class Downloads extends RpcTarget {
    async publications() {
      return { resourceUrl: 'https://objects.example/doc', nextCursor: '', publications: [
        { id: 'private:' + 'd'.repeat(64), recordedAt: new Date(Date.now() - 4 * 60_000).toISOString(), actor: '', format: 'cloudflareos.document' },
        { id: 'event-2', recordedAt: '2026-09-02T10:00:00Z', actor: 'Анна', format: 'cloudflareos.document' },
        { id: 'event-1', recordedAt: '2026-08-18T10:00:00Z', actor: 'Павел', format: 'cloudflareos.document' },
      ] }
    }
    async select(_scope: string, _node: string, publication: string) { selected.push(publication); return new RpcStub(new Side()) }
  }
  download.mockImplementation(async () => ({ format: 'cloudflareos.document', formatVersion: 1, document: { title: 'План запуска', blocks: [{ html: '<p>Текст</p>' }] } }))
  sessionStorage.setItem('mnemos-native-review:/:project', 'proposal')
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc', savedRevision: 7 })
  const panel = () => document.querySelector('[data-version-panel]')
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toContain('Кандидат')) })
    await view.click('Версии')
    await act(async () => { await vi.waitFor(() => expect(panel()!.querySelector('h2')?.textContent).toBe('Версии «План запуска»')) })
    expect(panel()!.querySelectorAll('select')).toHaveLength(0)
    for (const gone of ['Сменить', 'Перечитать', 'Пригласить', 'Кто видит', 'Согласование мне', 'Подключение']) expect(panel()!.textContent).not.toContain(gone)
    const rows = [...panel()!.querySelectorAll('ol[aria-label="Версии документа"] button')].map(b => b.textContent)
    expect(rows[0]).toContain('Версия 3 — ждёт согласования'); expect(rows[0]).toContain('Вы')
    expect(rows[1]).toContain('Версия 2 · опубликована'); expect(rows[1]).toContain('Анна')
    expect(rows[2]).toContain('Версия 1 · опубликована'); expect(rows[2]).toContain('Павел')
    expect(panel()!.textContent).toContain('Ни одна версия не пропадает. Вернуть можно любую — это станет новой версией.')
    // Одна главная кнопка по состоянию: заявка отправлена — ждёт решения по имени согласующего.
    expect(panel()!.querySelector('[data-version-primary]')?.textContent).toBe('Ждёт согласования: Иван Петров')
    expect(view.button('Вернуть версию 2')).toBeDefined()
    await view.click('Сравнить 2 и 3')
    await act(async () => { await vi.waitFor(() => expect(panel()!.textContent).toContain('Версия 2')) })
    expect(selected).toEqual(['event-2', 'private:' + 'd'.repeat(64)])
    await act(async () => { (panel()!.querySelectorAll('ol[aria-label="Версии документа"] button')[1] as HTMLButtonElement).click() })
    expect(view.button('Сравнить 1 и 2')).toBeDefined()
    expect(view.button('Вернуть версию 2')).toBeDefined()
    await act(async () => { (document.querySelector('button[aria-label="Назад к документу"]') as HTMLButtonElement).click() })
    expect(panel()).toBeNull()
  } finally { await view.unmount() }
})

it('смена документа — из меню «…»: «Привязать» объявляет текущую ревизию сохранённой, главное действие — «Опубликовать»', async () => {
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Команда' }] } }
    async documents() { return { documents: [{ id: 'doc', name: 'План запуска' }], nextCursor: '', truncated: false } }
    async publicationState() { return { personal_head: head, shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async participants() { return { head, nextCursor: '', participants: [] } }
    async reviewerIdentity() { return 'owner' }
  }
  class Downloads extends RpcTarget { async publications() { return { resourceUrl: '', nextCursor: '', publications: [] } } }
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc' })
  const status = () => document.querySelector('[data-document-status]')!.textContent
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(status()).toContain('сверить не с чем')) })
    expect(document.querySelector('button[data-primary-action]')?.textContent).toBe('Сохранить')
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_BIND_EVENT)) })
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Проект документа"]')?.querySelectorAll('option').length).toBe(2)) })
    const select = async (label: string, value: string) => {
      const element = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })) })
    }
    await select('Проект документа', 'project')
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Документ Mnemos в редакторе"]')?.querySelectorAll('option').length).toBe(2)) })
    await select('Документ Mnemos в редакторе', 'doc')
    await view.click('Привязать')
    await act(async () => { await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem(view.key)!).savedRevision).toBe(7)) })
    await act(async () => { await vi.waitFor(() => expect(status()).toContain('сохранено')) })
    expect(document.querySelector('button[data-primary-action]')?.textContent).toBe('Опубликовать')
  } finally { await view.unmount() }
})

it('«Поделиться» документом: человек по имени, «может править», сразу сохраняется; право меняется в строке; «Убрать»', async () => {
  const people = [
    { id: 'user-FGTK3l4q5INoE4X1', name: 'Николай Деревцов', mode: '' as string, canRead: true, canWrite: true },
    { id: 'reader-1', name: 'Ольга Кузнецова', mode: 'read' as string, canRead: true, canWrite: false },
  ]
  const calls: unknown[][] = []
  class Writer extends RpcTarget { async head() { return head } async access() { return 'owner' } }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: head, shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async documentLocation() { return { head, name: 'Дорожная карта', parent: '' } }
    async participants() { return { head, nextCursor: '', participants: people.map(p => ({ ...p })) } }
    async setParticipant(...args: unknown[]) {
      calls.push(args)
      const person = people.find(p => p.id === args[3])!
      if (person.mode !== args[4]) throw new Error('changed')
      person.mode = args[5] as string
    }
    async projectLevel() { return { name: 'Mnemos', level: 'private', canEdit: false, pending: null } }
    async reviewerIdentity() { return 'owner' }
  }
  class Downloads extends RpcTarget { async publications() { return { resourceUrl: '', nextCursor: '', publications: [] } } }
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc', savedRevision: 7 })
  const panel = () => document.querySelector('[data-share-panel]')
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toContain('сохранено')) })
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_SHARE_EVENT)) })
    await act(async () => { await vi.waitFor(() => expect(panel()?.querySelector('h2')?.textContent).toBe('Кто видит «Дорожная карта»')) })
    await act(async () => { await vi.waitFor(() => expect(panel()!.querySelector('[data-share-person]')).not.toBeNull()) })
    expect(panel()!.querySelectorAll('select')).toHaveLength(0)
    expect(panel()!.textContent).not.toContain('user-FGTK3l4q5INoE4X1')
    expect(panel()!.textContent).toContain('Только приглашённые'); expect(panel()!.textContent).toContain('Мой отдел'); expect(panel()!.textContent).toContain('Вся организация')
    expect(panel()!.textContent).toContain('Ольга Кузнецова')
    const input = panel()!.querySelector('input#share-person') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'никол'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const suggestion = [...panel()!.querySelectorAll('[role="option"]')].find(o => o.textContent?.includes('Николай Деревцов')) as HTMLButtonElement
    expect(suggestion).toBeDefined()
    await act(async () => suggestion.click())
    await view.click('Пригласить')
    await act(async () => { await vi.waitFor(() => expect(calls).toHaveLength(1)) })
    expect(calls[0]).toEqual(['project', 'doc', head, 'user-FGTK3l4q5INoE4X1', '', 'write'])
    await act(async () => { await vi.waitFor(() => expect(panel()!.textContent).toContain('получит уведомление во «Входящих» и письмо')) })
    // Право меняется щелчком в строке и сохраняется сразу.
    const row = () => [...panel()!.querySelectorAll('[data-share-person]')].find(r => r.textContent?.includes('Николай Деревцов'))!
    await act(async () => { await vi.waitFor(() => expect(row()).toBeDefined()) })
    await act(async () => { ([...row().querySelectorAll('button')].find(b => b.textContent === 'может смотреть') as HTMLButtonElement).click() })
    await act(async () => { await vi.waitFor(() => expect(calls).toHaveLength(2)) })
    expect(calls[1]).toEqual(['project', 'doc', head, 'user-FGTK3l4q5INoE4X1', 'write', 'read'])
    await act(async () => { await vi.waitFor(() => expect(row().querySelector('[aria-checked="true"]')?.textContent).toBe('может смотреть')) })
    await act(async () => { ([...row().querySelectorAll('button')].find(b => b.textContent === 'Убрать') as HTMLButtonElement).click() })
    await act(async () => { await vi.waitFor(() => expect(calls).toHaveLength(3)) })
    expect(calls[2]).toEqual(['project', 'doc', head, 'user-FGTK3l4q5INoE4X1', 'read', ''])
    await act(async () => { await vi.waitFor(() => expect(panel()!.textContent).toContain('больше не видит документ')) })
  } finally { await view.unmount() }
})

it('приглашённому «Поделиться» объясняет, что приглашает владелец; шапка — общий документ без публикации', async () => {
  class Writer extends RpcTarget { async head() { return head } async access() { return 'write' } }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: 'e'.repeat(64), shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async sharedDocuments() { return { documents: [{ scope: 'project', resource: 'doc', owner: 'owner', name: 'Дорожная карта', format: 'cloudflareos.document', projectName: 'Mnemos', ownerName: 'Николай Деревцов', grantedByName: 'Николай Деревцов', mode: 'write', grantedAt: '2026-09-24T10:00:00Z', seen: false }] } }
    async participants() { throw new Error('owner only') }
    async reviewerIdentity() { return 'mnemos-owner' }
  }
  class Downloads extends RpcTarget { async publications() { return { resourceUrl: '', nextCursor: '', publications: [] } } }
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc', savedRevision: 7, savedHead: head })
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toContain('Общий документ')) })
    expect(document.querySelector('button[data-primary-action]')).toBeNull()
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_SHARE_EVENT)) })
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-share-panel]')?.textContent).toContain('Приглашать других может его владелец')) })
    expect(document.querySelector('[data-share-panel] h2')?.textContent).toBe('Кто видит «Дорожная карта»')
  } finally { await view.unmount() }
})
