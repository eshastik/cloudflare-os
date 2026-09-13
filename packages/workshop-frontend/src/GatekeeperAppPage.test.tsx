// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'
import GatekeeperAppPage from './GatekeeperAppPage'

const api = vi.hoisted(() => ({ getGatekeeperApp: vi.fn(), subscribeConnectedAccounts: vi.fn(), reconnectAccount: vi.fn() }))
const dispose = vi.hoisted(() => vi.fn())
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./SandboxedGatekeeperApp', () => ({ default: () => <div>Opened application</div> }))
vi.mock('./errorReporting', () => ({ reportIssue: vi.fn() }))
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: dispose }))
vi.mock('./OrganizationSummaryPanel', () => ({ default: () => null }))
vi.mock('./CalendarConnectionPanel', () => ({ default: () => <div>Подключить Google Calendar к Mnemos</div> }))
vi.mock('./MailConnectionPanel', () => ({ default: () => null }))
vi.mock('./DriveImportPanel', () => ({ default: () => null }))
beforeEach(() => vi.resetAllMocks())
async function selectAccount(container: HTMLElement, id: number) {
  const select = container.querySelector('select')!
  await act(async () => { select.value = String(id); select.dispatchEvent(new Event('change', { bubbles: true })) })
}
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('recovers with the selected own service account, clears the error, and releases resources', async () => {
  const subscriptionDisposed = vi.fn()
  api.subscribeConnectedAccounts.mockImplementation(async (s: ConnectedAccountsSubscriber) => {
    s.add(7, { displayName: 'Peer account', avatar: { url: 'https://example.test/avatar' } }, { displayName: 'Mnemos', url: 'https://example.test' }, [], false, 'mnemos')
    s.add(9, { displayName: 'Other service account', avatar: { url: 'https://example.test/avatar' } }, { displayName: 'Other', url: 'https://example.test' }, [], false, 'other')
    s.ready()
    return { [Symbol.dispose]: subscriptionDisposed }
  })
  const frame = { html: '<p>Application</p>' }
  api.getGatekeeperApp.mockRejectedValueOnce(new Error('Sign-in expired')).mockResolvedValueOnce(frame)
  api.reconnectAccount.mockResolvedValue({ url: 'https://login.example/reconnect' })
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === label)
    expect(button).toBeDefined()
    await act(async () => button!.click())
  }
  try {
    await act(async () => root.render(<GatekeeperAppPage appId="mnemos" />))
    expect(api.getGatekeeperApp).not.toHaveBeenCalled()
    await selectAccount(container, 7)
    expect(api.getGatekeeperApp).toHaveBeenLastCalledWith('mnemos', 7)
    expect(container.textContent).toContain('Sign-in expired')
    expect(container.textContent).not.toContain('Other service account')
    await click('Reconnect Peer account')
    expect(api.reconnectAccount).toHaveBeenCalledWith(7)
    const link = container.querySelector('a')!
    expect(link.href).toBe('https://login.example/reconnect')
    expect(link.rel).toBe('noopener noreferrer')
    await click('Open app again')
    expect(container.textContent).toContain('Opened application')
    expect(container.textContent).toContain('Подключить Google Calendar к Mnemos')
    expect(api.getGatekeeperApp).toHaveBeenCalledTimes(2)
    expect(subscriptionDisposed).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    container.remove(); errors.mockRestore()
  }
  expect(dispose).toHaveBeenCalledWith(frame)
})

it('opens consent for the opaque OAuth request without rendering the embedded app or approving it', async () => {
  api.subscribeConnectedAccounts.mockImplementation(async (s: ConnectedAccountsSubscriber) => {
    s.add(11, { displayName: 'Candidate', avatar: { url: 'https://example.test/avatar' } }, { displayName: 'Mnemos', url: 'https://example.test' }, [], true, 'mnemos')
    s.ready()
    return { [Symbol.dispose]: vi.fn() }
  })
  const preview = vi.fn(async () => ({ selection: 's', account: 'org / alice', client_id: 'client', resource: 'https://memory.example/mcp', scopes: ['memory'], expires_at: '2099-01-01T00:00:00Z' }))
  const decide = vi.fn()
  const frame = { iframeHtml: '<p>Application</p>', agentConsent: { preview, decide } }
  api.getGatekeeperApp.mockResolvedValue(frame)
  const container = document.createElement('div'), root = createRoot(container)
  window.history.replaceState(null, '', '/gatekeepers/mnemos?request_id=' + 'a'.repeat(43))
  try {
    await act(async () => root.render(<GatekeeperAppPage appId="mnemos" />))
    expect(preview).not.toHaveBeenCalled()
    await selectAccount(container, 11)
    expect(api.getGatekeeperApp).toHaveBeenCalledWith('mnemos', 11)
    expect(preview).toHaveBeenCalledWith('a'.repeat(43))
    expect(decide).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Подключение личного агента')
    expect(container.textContent).not.toContain('Opened application')
  } finally {
    await act(async () => root.unmount())
    window.history.replaceState(null, '', '/')
  }
  expect(dispose).toHaveBeenCalledWith(frame)
})


it('disposes a late frame after switching accounts and closes a removed account', async () => {
  let subscriber: ConnectedAccountsSubscriber
  const subscriptionDisposed = vi.fn()
  api.subscribeConnectedAccounts.mockImplementation(async (s: ConnectedAccountsSubscriber) => {
    subscriber = s
    for (const id of [2, 11]) s.add(id, { displayName: `Org ${id}`, avatar: { url: 'https://example.test/avatar' } }, { displayName: 'Mnemos', url: 'https://example.test' }, [], true, 'mnemos')
    return { [Symbol.dispose]: subscriptionDisposed }
  })
  let resolveFirst!: (value: object) => void
  const first = { html: 'first' }, second = { html: 'second' }
  api.getGatekeeperApp.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve })).mockResolvedValueOnce(second)
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(<GatekeeperAppPage appId="mnemos" />))
    await selectAccount(container, 2)
    await selectAccount(container, 11)
    await act(async () => resolveFirst(first))
    expect(dispose).toHaveBeenCalledWith(first)
    expect(api.getGatekeeperApp.mock.calls).toEqual([['mnemos', 2], ['mnemos', 11]])
    expect(container.textContent).toContain('Opened application')
    await act(async () => subscriber.remove(11))
    expect(container.textContent).not.toContain('Opened application')
    expect(dispose).toHaveBeenCalledWith(second)
    expect(container.querySelector('select')!.value).toBe('')
  } finally { await act(async () => root.unmount()) }
  expect(subscriptionDisposed).toHaveBeenCalledOnce()
})
