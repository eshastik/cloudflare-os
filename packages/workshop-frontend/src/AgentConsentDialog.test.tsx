// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { RpcStub, RpcTarget } from 'capnweb'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'
import AgentConsentDialog from './AgentConsentDialog'

const api = vi.hoisted(() => ({ getGatekeeperApp: vi.fn(), subscribeConnectedAccounts: vi.fn() }))
const dispose = vi.hoisted(() => vi.fn<(frame: unknown) => void>())
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: dispose }))
beforeEach(() => vi.resetAllMocks())
// Kumo падает в jsdom без ResizeObserver.
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const REQUEST = 'a'.repeat(43)
const avatar = { url: 'https://example.test/avatar' }
const vendor = { displayName: 'Память', url: 'https://example.test' }
const previewValue = { selection: 'selection', account: 'org / alice', client_id: 'local-client', resource: 'https://memory.example/mcp', scopes: ['memory', 'drafts'], expires_at: '2099-01-01T00:00:00Z' }

/** Три аккаунта: без экрана управления, чужой вендор без agentConsent и аккаунт памяти с agentConsent. */
function subscribeAccounts(consentFrame: object | null) {
  const plain = { iframeHtml: '', ui: {} }
  api.subscribeConnectedAccounts.mockImplementation(async (s: ConnectedAccountsSubscriber) => {
    s.add(5, { displayName: 'Без экрана', avatar }, vendor, [], true, 'memory')
    s.add(6, { displayName: 'Чужой', avatar, providesUi: { title: 'Другое' } }, vendor, [], true, 'other')
    s.add(7, { displayName: 'Организация', avatar, providesUi: { title: 'Память' } }, vendor, [], true, 'memory')
    s.ready()
    return { [Symbol.dispose]: vi.fn<() => void>() }
  })
  api.getGatekeeperApp.mockImplementation(async (vendorId: string) => vendorId === 'other' ? plain : consentFrame)
  return plain
}

function buttons() { return [...document.body.querySelectorAll('button')].filter(b => b.textContent === 'Подключить агента' || b.textContent === 'Отклонить') }

async function mount(requestIds: string[]) {
  const onClose = vi.fn<() => void>()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<AgentConsentDialog requestIds={requestIds} api={api} onClose={onClose} />))
  return { onClose, unmount: async () => { await act(async () => root.unmount()); container.remove() } }
}

for (const host of ['127.0.0.1', 'localhost']) for (const approved of [true, false]) it(`opens the consent frame of the account offering it, shows the request line by line, returns to ${host} after an explicit ${approved ? 'approval' : 'denial'}`, async () => {
  class Consent extends RpcTarget {
    previewCall = vi.fn(async (_request: string) => previewValue)
    decideCall = vi.fn(async (_selection: string, _approved: boolean) => ({ redirect_uri: `http://${host}:4321/callback?state=saved&${approved ? 'code=issued' : 'error=access_denied'}` }))
    async preview(request: string) { return this.previewCall(request) }
    async decide(selection: string, approved: boolean) { return this.decideCall(selection, approved) }
  }
  const target = new Consent(), capability = new RpcStub(target)
  const frame = { iframeHtml: '', ui: {}, agentConsent: capability }
  const plain = subscribeAccounts(frame)
  const { unmount } = await mount([REQUEST])
  try {
    expect(api.getGatekeeperApp.mock.calls).toEqual([['other', 6], ['memory', 7]])
    expect(dispose).toHaveBeenCalledWith(plain)
    expect(target.previewCall).toHaveBeenCalledWith(REQUEST)
    expect(target.decideCall).not.toHaveBeenCalled()
    const text = document.body.textContent ?? ''
    expect(text).toContain('org / alice')
    expect(text).toContain('local-client')
    expect(text).toContain('https://memory.example/mcp')
    expect(text).toContain('собственные разрешения')
    expect(text).not.toContain('получает ваши права')
    expect(text).toContain('записыва')
    expect(text).toContain('аудит')
    expect(text).toContain('всем документам')
    // Операции и область — построчно: у каждой запрошенной операции своя строка.
    expect(document.body.querySelectorAll('[data-scope-line]')).toHaveLength(2)
    expect(document.body.querySelector('[data-scope-line="memory"]')).not.toBeNull()
    expect(document.body.querySelector('[data-scope-line="drafts"]')).not.toBeNull()
    expect(text).toContain('2099')
    const button = buttons().find(b => b.textContent === (approved ? 'Подключить агента' : 'Отклонить'))!
    await act(async () => { button.click(); button.click() })
    expect(target.decideCall).toHaveBeenCalledExactlyOnceWith('selection', approved)
    const links = [...document.body.querySelectorAll('a')]
    const callback = links.find(a => a.href.includes('callback'))!
    expect(new URL(callback.href).searchParams.get('state')).toBe('saved')
    expect(new URL(callback.href).searchParams.has('code')).toBe(approved)
    expect(callback.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(document.body.textContent).toContain('Вернитесь в клиент агента')
    expect(links.find(a => a.getAttribute('href') === '/gatekeepers/memory')).toBeDefined()
    expect(buttons()).toHaveLength(0)
  } finally {
    await unmount(); capability[Symbol.dispose]()
  }
  expect(dispose).toHaveBeenCalledWith(frame)
})

it('does not retry an uncertain issuance or show an unsafe callback', async () => {
  for (const callback of [null, 'javascript:alert(1)', 'http://evil.example/callback']) {
    class Consent extends RpcTarget {
      async preview() { return previewValue }
      decideCall = vi.fn(async (_selection: string, _approved: boolean) => { if (!callback) throw new Error('lost response'); return { redirect_uri: callback } })
      async decide(selection: string, approved: boolean) { return this.decideCall(selection, approved) }
    }
    const target = new Consent(), capability = new RpcStub(target)
    subscribeAccounts({ iframeHtml: '', ui: {}, agentConsent: capability })
    const { unmount } = await mount([REQUEST])
    try {
      await act(async () => buttons()[0].click())
      expect(target.decideCall).toHaveBeenCalledOnce()
      expect([...document.body.querySelectorAll('a')].find(a => a.href.includes('callback') || a.href.startsWith('javascript'))).toBeUndefined()
      expect(buttons()).toHaveLength(0)
      expect(document.body.textContent).toContain('Результат не подтверждён')
    } finally { await unmount(); capability[Symbol.dispose]() }
  }
})

it('reports a malformed, repeated or missing request in the dialog without opening any frame', async () => {
  for (const requestIds of [['short'], [REQUEST, 'b'.repeat(43)], ['a'.repeat(42) + '!'], []]) {
    subscribeAccounts({ iframeHtml: '', ui: {}, agentConsent: { preview: vi.fn<() => void>(), decide: vi.fn<() => void>() } })
    const { unmount } = await mount(requestIds)
    try {
      expect(api.getGatekeeperApp).not.toHaveBeenCalled()
      expect(api.subscribeConnectedAccounts).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain('Ссылка на подключение агента неверна')
      expect(buttons()).toHaveLength(0)
    } finally { await unmount() }
  }
})

it('reports when no connected account offers agent consent and releases every opened frame', async () => {
  const plain = subscribeAccounts({ iframeHtml: '', ui: {} })
  const { unmount } = await mount([REQUEST])
  try {
    expect(api.getGatekeeperApp.mock.calls).toEqual([['other', 6], ['memory', 7]])
    expect(dispose).toHaveBeenCalledWith(plain)
    expect(document.body.textContent).toContain('Ни одно подключение не принимает агентов')
    expect(buttons()).toHaveLength(0)
  } finally { await unmount() }
})
