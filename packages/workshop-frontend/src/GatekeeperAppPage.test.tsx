// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'
import type { SupportedResource } from '@gadgets/workshop-shared/gatekeeper'
import GatekeeperAppPage from './GatekeeperAppPage'

const api = vi.hoisted(() => ({ getGatekeeperApp: vi.fn(), subscribeConnectedAccounts: vi.fn(), reconnectAccount: vi.fn() }))
const dispose = vi.hoisted(() => vi.fn<(frame: unknown) => void>())
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./SandboxedGatekeeperApp', () => ({ default: () => <div>Opened application</div> }))
vi.mock('./errorReporting', () => ({ reportIssue: vi.fn() }))
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: dispose }))
vi.mock('./OrganizationSummaryPanel', () => ({ default: ({ appId }: { appId: string }) => 'Свод организаций ' + appId }))
vi.mock('./CalendarConnectionPanel', () => ({ default: () => 'Панель календаря' }))
vi.mock('./MailConnectionPanel', () => ({ default: () => 'Панель почты' }))
vi.mock('./DriveImportPanel', () => ({ default: () => 'Панель диска' }))
beforeEach(() => vi.resetAllMocks())
// Kumo падает в jsdom без ResizeObserver.
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ui = { providesUi: { title: 'Память' }, avatar: { url: 'https://example.test/avatar' } }
const vendor = { displayName: 'Память', url: 'https://example.test' }
const resource = (receives: SupportedResource['receives']): SupportedResource => ({ urlPattern: `https://example.test/${receives}`, description: '', title: '', receives })
function addAccount(s: ConnectedAccountsSubscriber, id: number, name: string, vendorId = 'memory', resources: SupportedResource[] = []) {
  s.add(id, { displayName: name, ...ui }, vendor, resources, true, vendorId)
}
const page = (key = 0) => <GatekeeperAppPage key={key} appId="memory" />
async function chooseAccount(name: string) {
  const trigger = document.querySelector<HTMLElement>('[role="combobox"]')
  expect(trigger).not.toBeNull()
  await act(async () => trigger!.click())
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === name)
  expect(option).toBeDefined()
  // Base UI принимает клик по опции только после pointerdown на ней; клик без него считается случайным.
  await act(async () => { option!.dispatchEvent(new Event('pointerdown', { bubbles: true })); option!.click() })
}

it('opens the only account of the vendor at once, recovers with it, clears the error, and releases resources', async () => {
  const subscriptionDisposed = vi.fn<() => void>()
  api.subscribeConnectedAccounts.mockImplementation(async (s: ConnectedAccountsSubscriber) => {
    addAccount(s, 7, 'Peer account', 'memory', [resource('calendar')])
    addAccount(s, 9, 'Other service account', 'other')
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
    await act(async () => root.render(page()))
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(api.getGatekeeperApp).toHaveBeenLastCalledWith('memory', 7)
    expect(container.textContent).toContain('Не удалось открыть «Память»')
    expect(container.textContent).not.toContain('Other service account')
    await click('Переподключить Peer account')
    expect(api.reconnectAccount).toHaveBeenCalledWith(7)
    const link = container.querySelector('a')!
    expect(link.href).toBe('https://login.example/reconnect')
    expect(link.rel).toBe('noopener noreferrer')
    await click('Открыть приложение ещё раз')
    expect(container.textContent).toContain('Opened application')
    expect(container.textContent).not.toContain('Панель календаря')
    await click('Подключения')
    expect(document.body.textContent).toContain('Панель календаря')
    expect(container.textContent).not.toContain('Панель почты')
    expect(api.getGatekeeperApp).toHaveBeenCalledTimes(2)
    expect(subscriptionDisposed).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    container.remove(); errors.mockRestore()
  }
  expect(dispose).toHaveBeenCalledWith(frame)
})

it('shows the mail panel only for an account receiving mail and the summary only for a frame with organization metrics', async () => {
  const container = document.createElement('div'), root = createRoot(container)
  document.body.append(container)
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)
    expect(button).toBeDefined()
    await act(async () => button!.click())
  }
  const render = async (resources: SupportedResource[], frame: object) => {
    api.subscribeConnectedAccounts.mockImplementation(async (s: ConnectedAccountsSubscriber) => { addAccount(s, 3, 'Org', 'memory', resources); s.ready(); return { [Symbol.dispose]: vi.fn<() => void>() } })
    api.getGatekeeperApp.mockResolvedValue(frame)
    await act(async () => root.render(page(resources.length)))
    expect(container.textContent).toContain('Opened application')
  }
  try {
    await render([resource('mail'), resource('drive')], { html: '', organizationMetrics: { read: vi.fn<() => void>() } })
    expect(document.body.textContent).not.toContain('Панель почты')
    expect(document.body.textContent).not.toContain('Панель диска')
    await click('Подключения')
    expect(document.body.textContent).toContain('Панель почты')
    expect(document.body.textContent).not.toContain('Панель календаря')
    await click('Файлы')
    expect(document.body.textContent).toContain('Панель диска')
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть"]')!.click())
    await click('Свод организаций')
    expect(document.body.textContent).toContain('Свод организаций memory')
    await render([], { html: '' })
    expect(container.textContent).not.toContain('Панель почты')
    expect(container.textContent).not.toContain('Панель диска')
    expect(container.textContent).not.toContain('Свод организаций')
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('offers a Kumo account choice for several accounts, disposes a late frame after switching, and opens the remaining account after removal', async () => {
  let subscriber: ConnectedAccountsSubscriber
  const subscriptionDisposed = vi.fn<() => void>()
  api.subscribeConnectedAccounts.mockImplementation(async (s: ConnectedAccountsSubscriber) => {
    subscriber = s
    for (const id of [2, 11]) addAccount(s, id, `Org ${id}`)
    s.ready()
    return { [Symbol.dispose]: subscriptionDisposed }
  })
  let resolveFirst!: (value: object) => void
  const first = { html: 'first' }, second = { html: 'second' }, third = { html: 'third' }
  api.getGatekeeperApp.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve })).mockResolvedValueOnce(second).mockResolvedValueOnce(third)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(page()))
    expect(api.getGatekeeperApp).not.toHaveBeenCalled()
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).toContain('Организация')
    await chooseAccount('Org 2')
    await chooseAccount('Org 11')
    await act(async () => resolveFirst(first))
    expect(dispose).toHaveBeenCalledWith(first)
    expect(api.getGatekeeperApp.mock.calls).toEqual([['memory', 2], ['memory', 11]])
    expect(container.textContent).toContain('Opened application')
    await act(async () => subscriber.remove(11))
    expect(dispose).toHaveBeenCalledWith(second)
    expect(api.getGatekeeperApp.mock.calls[2]).toEqual(['memory', 2])
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    expect(container.textContent).toContain('Opened application')
  } finally { await act(async () => root.unmount()); container.remove() }
  expect(subscriptionDisposed).toHaveBeenCalledOnce()
})
