// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import DocumentStatus from './DocumentStatus'

const { api, download } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(subscriber: ConnectedAccountsSubscriber) => Promise<unknown>>() }, download: vi.fn<(...args: any[]) => Promise<unknown>>() }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperNativeReview: download, downloadGatekeeperNativeDocument: vi.fn<() => Promise<null>>() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

it('панель «Версия»: согласующие с решениями, участники, история со сравнением и согласование мне', async () => {
  const decisions: unknown[][] = []
  const head = 'a'.repeat(64), shared = 'b'.repeat(64)
  const mine = { candidate_id: 'proposal', project_id: 'project', author_id: 'owner', personal_head: head, shared_head: shared, decision_version: 3, stale: false, ready: false,
    domains: [
      { domain_id: 'Дизайн', node_ids: ['doc'], approvers: ['maria'], decisions: [{ approver_id: 'maria', approved: true }] },
      { domain_id: 'Разработка', node_ids: ['doc'], approvers: ['ivan'], decisions: [{ approver_id: 'ivan', approved: false, comment: 'сроки не бьются со спринтом' }] },
    ] }
  let incomingVersion = 1, incomingApproved: boolean | undefined
  const incoming = () => ({ candidate_id: 'incoming', project_id: 'project', author_id: 'colleague', personal_head: 'c', shared_head: shared, decision_version: incomingVersion, stale: false, ready: incomingApproved === true,
    domains: [{ domain_id: 'Разработка', node_ids: ['other'], approvers: ['reviewer'], decisions: incomingApproved === undefined ? [] : [{ approver_id: 'reviewer', approved: incomingApproved }] }] })
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Команда' }] } }
    async documents() { return { documents: [{ id: 'doc', name: 'План запуска' }], nextCursor: '', truncated: false } }
    async publicationState(scope: string) { expect(scope).toBe('project'); return { personal_head: head, shared_head: shared, personal_exists: true } }
    async select(scope: string, node: string, format: string) { expect([scope, node, format]).toEqual(['project', 'doc', 'cloudflareos.document']); return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async participants(scope: string, node: string, expected: string) {
      expect([scope, node, expected]).toEqual(['project', 'doc', head])
      return { head, nextCursor: '', participants: [{ id: 'maria', name: 'Мария', mode: 'read', canRead: true, canWrite: false }, { id: 'ivan', name: 'Иван', mode: '', canRead: true, canWrite: true }] }
    }
    async review(id: string) { return id === 'proposal' ? mine : incoming() }
    async reviewerIdentity() { return 'reviewer' }
    async reviewInbox() { return { reviews: [incoming()], next_cursor: '' } }
    async decideReview(...args: unknown[]) { decisions.push(args); incomingApproved = args[3] as boolean; incomingVersion++ }
  }
  class Side extends RpcTarget { async validate() {} [Symbol.dispose]() {} }
  class Downloads extends RpcTarget {
    async publications(scope: string, node: string) {
      expect([scope, node]).toEqual(['project', 'doc'])
      return { resourceUrl: 'https://objects.example/doc', nextCursor: '', publications: [
        { id: 'private:' + 'd'.repeat(64), recordedAt: new Date(Date.now() - 4 * 60_000).toISOString(), actor: '', format: 'cloudflareos.document' },
        { id: 'event-2', recordedAt: '2026-09-02T10:00:00Z', actor: 'Анна', format: 'cloudflareos.document' },
        { id: 'event-1', recordedAt: '2026-08-18T10:00:00Z', actor: 'Павел', format: 'cloudflareos.document' },
      ] }
    }
    async selectReview(id: string, node: string, version: number, side: string, format: string) {
      expect([id, node, version, format]).toEqual(['proposal', 'doc', 3, 'cloudflareos.document']); expect(['before', 'after']).toContain(side)
      return new RpcStub(new Side())
    }
  }
  download.mockImplementation(async (_origin, selection, _format, _signal, onMetadata) => {
    await selection.validate(); onMetadata({ name: 'План запуска.cfdoc', parent_id: '' })
    return { format: 'cloudflareos.document', formatVersion: 1, document: { title: 'План запуска', blocks: [{ html: '<p>Текст</p>' }] } }
  })
  class Empty extends RpcTarget {}
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }))
  api.subscribeConnectedAccounts.mockImplementation(async subscriber => { subscriber.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); subscriber.ready(); return new RpcStub(new Empty()) })
  class Gadget extends RpcTarget { async getId() { return 'native-doc' } async getNativeEditorUpdate() { return { codeVersion: 1, revision: 7, changedFiles: [] } } }
  const gadget = new RpcStub(new Gadget())
  sessionStorage.setItem('mnemos-native-binding:/:native-doc:cloudflareos.document', JSON.stringify({ accountId: null, scope: 'project', resource: 'doc', savedRevision: 7 }))
  sessionStorage.setItem('mnemos-native-review:/:project', 'proposal')
  const snapshotSource = { current: vi.fn<() => Promise<{ format: 'cloudflareos.document'; formatVersion: 1; document: { revision: number; title: string; blocks: never[] } }>>(async () => ({ format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: 7, title: 'План запуска', blocks: [] } })) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)
  const click = async (text: string) => { expect(button(text)).toBeDefined(); expect(button(text)!.disabled).toBe(false); await act(async () => button(text)!.click()) }
  const panel = () => document.querySelector('[data-version-panel]')
  try {
    await act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} />))
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toContain('Кандидат от v2')) })
    const status = document.querySelector('[data-document-status]')!
    expect(status.textContent).toContain('видят вы и Мария')
    expect(status.textContent).toContain('Разработка: отказ — «сроки не бьются со спринтом»')
    expect(document.querySelector('button[data-primary-action]')?.textContent).toBe('Доработать')

    expect(panel()).toBeNull()
    await click('Версии')
    expect(panel()).not.toBeNull()
    expect(panel()!.querySelector('h2')?.textContent).toBe('Версии')
    const approvers = panel()!.querySelector('[data-section="approvers"]')!
    expect(approvers.textContent).toContain('Дизайн'); expect(approvers.textContent).toContain('Мария'); expect(approvers.textContent).toContain('Одобрено')
    expect(approvers.textContent).toContain('Разработка'); expect(approvers.textContent).toContain('Иван'); expect(approvers.textContent).toContain('Отклонено')
    expect(approvers.textContent).toContain('сроки не бьются со спринтом')

    const people = panel()!.querySelector('[data-section="participants"]')!
    expect(people.textContent).toContain('Вы'); expect(people.textContent).toContain('Мария'); expect(people.textContent).toContain('Чтение')
    expect(people.textContent).not.toContain('Иван')
    await click('Пригласить')
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Доступ: Мария"]')).not.toBeNull()) })

    const history = panel()!.querySelector('[data-section="history"]')!
    expect(history.textContent).toContain('v2'); expect(history.textContent).toContain('Анна')
    expect(history.textContent).toContain('v1'); expect(history.textContent).toContain('Павел')
    expect(history.textContent).toContain('Личная версия')
    await click('Сравнить с v2')
    await act(async () => { await vi.waitFor(() => expect(document.body.textContent).toContain('Предложенная версия')) })
    expect(document.querySelector('iframe[title="Содержимое: План запуска"]')).not.toBeNull()

    const inbox = panel()!.querySelector('[data-section="inbox"]')!
    await act(async () => { await vi.waitFor(() => expect(inbox.textContent).toContain('Разработка')) })
    await click('Открыть согласование')
    await click('Одобрить')
    expect(decisions).toEqual([['incoming', 'Разработка', 1, true]])
    expect(document.body.textContent).toContain('вы одобрили')

    await act(async () => { (document.querySelector('button[aria-label="Назад к документу"]') as HTMLButtonElement).click() })
    expect(panel()).toBeNull()
  } finally { await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]() }
})

it('«Привязать» объявляет текущую ревизию редактора сохранённой: до привязки «сверить не с чем», после — «сохранено»', async () => {
  const head = 'a'.repeat(64)
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Команда' }] } }
    async documents() { return { documents: [{ id: 'doc', name: 'План запуска' }], nextCursor: '', truncated: false } }
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
  sessionStorage.setItem(key, JSON.stringify({ accountId: null, scope: 'project', resource: 'doc' }))
  const snapshotSource = { current: async () => ({ format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: 7, title: 'План запуска', blocks: [] } }) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)
  const click = async (text: string) => { expect(button(text)).toBeDefined(); expect(button(text)!.disabled).toBe(false); await act(async () => button(text)!.click()) }
  const status = () => document.querySelector('[data-document-status]')!.textContent
  try {
    await act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} changesPollMs={0} />))
    await act(async () => { await vi.waitFor(() => expect(status()).toContain('сверить не с чем')) })
    expect(document.querySelector('button[data-primary-action]')?.textContent).toBe('Сохранить')
    await click('Версии'); await click('Сменить')
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Проект документа"]')?.querySelectorAll('option').length).toBe(2)) })
    const select = async (label: string, value: string) => {
      const element = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })) })
    }
    await select('Проект документа', 'project')
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Документ Mnemos в редакторе"]')?.querySelectorAll('option').length).toBe(2)) })
    await select('Документ Mnemos в редакторе', 'doc')
    await click('Привязать')
    await act(async () => { await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!).savedRevision).toBe(7)) })
    await act(async () => { await vi.waitFor(() => expect(status()).toContain('сохранено')) })
    expect(status()).not.toContain('сверить не с чем')
    expect(document.querySelector('button[data-primary-action]')?.textContent).toBe('На согласование')
  } finally { await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]() }
})
