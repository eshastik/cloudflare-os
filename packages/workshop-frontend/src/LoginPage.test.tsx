// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import LoginPage from './LoginPage'
import { POPUP_CLOSE_GRACE_MS } from './components/auth/OAuthButtons'

const state = vi.hoisted(() => ({
  config: { authVendors: [{ vendorId: 'mnemos', displayName: 'Mnemos' }], passwordAuthEnabled: false, signupsEnabled: false } as {
    authVendors: { vendorId: string; displayName: string }[]; passwordAuthEnabled: boolean; signupsEnabled: boolean },
}))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./ServerConfigContext', () => ({ useServerConfig: () => state.config, useServerConfigError: () => null, useSiteName: () => 'Mnemos' }))
vi.mock('./RpcContext', () => ({ useConnectionLost: () => false }))
vi.mock('./useDocumentTitle', () => ({ useDocumentTitle: vi.fn<() => void>() }))
vi.mock('./components/SiteLogo', () => ({ default: () => null }))

let root: Root, box: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.config = { authVendors: [{ vendorId: 'mnemos', displayName: 'Mnemos' }], passwordAuthEnabled: false, signupsEnabled: false }
  window.history.replaceState(null, '', '/')
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
})
afterEach(async () => { await React.act(async () => root.unmount()); box.remove(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })
const buttons = () => [...box.querySelectorAll('button')].map(b => b.textContent?.trim())
const rpc = (wait: () => Promise<string>) => ({ startGatekeeperLogin: vi.fn(async () => ({ url: 'https://os.example/gatekeeper/mnemos/oauth/start/a/b', attempt: { wait, [Symbol.dispose]() {} } })) })

it('по умолчанию одна кнопка «Войти» через Mnemos и никакого пароля оболочки', async () => {
  await React.act(async () => root.render(<LoginPage rpcStub={rpc(async () => '') as never} />))
  expect(buttons()).toEqual(['Войти'])
  expect(box.querySelector('input[type="password"]')).toBeNull()
  expect(box.textContent).toContain('Попросите руководителя прислать приглашение')
})

it('пароль оболочки — только аварийный доступ за ссылкой, если установка его оставила', async () => {
  state.config = { ...state.config, passwordAuthEnabled: true, signupsEnabled: true }
  await React.act(async () => root.render(<LoginPage rpcStub={rpc(async () => '') as never} />))
  expect(box.querySelector('input[type="password"]')).toBeNull()
  expect(box.textContent).not.toContain('Создать')
  const emergency = [...box.querySelectorAll('button')].find(b => b.textContent === 'Аварийный вход по паролю')!
  await React.act(async () => emergency.click())
  expect(box.querySelector('input[type="password"]')).not.toBeNull()
})

it('ссылка-приглашение: «Принять приглашение» открывает окно входа Mnemos и сохраняет сеанс', async () => {
  window.history.replaceState(null, '', '/gatekeepers/mnemos#invite')
  const popup = { closed: false }
  vi.spyOn(window, 'open').mockReturnValue(popup as Window)
  const stub = rpc(async () => 'anna@example.ru:secret')
  const done = vi.fn<() => void>()
  await React.act(async () => root.render(<LoginPage rpcStub={stub as never} onLoginSuccess={done} />))
  expect(box.querySelector('h1')?.textContent).toBe('Вас пригласили в Mnemos')
  const accept = [...box.querySelectorAll('button')].find(b => b.textContent === 'Принять приглашение')!
  await React.act(async () => accept.click())
  expect(stub.startGatekeeperLogin).toHaveBeenCalledWith('mnemos')
  expect(window.open).toHaveBeenCalledWith('https://os.example/gatekeeper/mnemos/oauth/start/a/b', 'gatekeeper-login', 'popup,width=520,height=680')
  expect(localStorage.getItem('authToken')).toBe('anna@example.ru:secret')
  expect(done).toHaveBeenCalledTimes(1)
})

it('закрывшееся само окно входа не отменяет вход, пока ответ ещё в пути', async () => {
  vi.useFakeTimers()
  const popup = { closed: false }
  vi.spyOn(window, 'open').mockReturnValue(popup as Window)
  let finish!: (token: string) => void
  const done = vi.fn<() => void>()
  await React.act(async () => root.render(<LoginPage rpcStub={rpc(() => new Promise(resolve => { finish = resolve })) as never} onLoginSuccess={done} />))
  await React.act(async () => [...box.querySelectorAll('button')].find(b => b.textContent === 'Войти')!.click())
  popup.closed = true
  await React.act(async () => { vi.advanceTimersByTime(POPUP_CLOSE_GRACE_MS - 500) })
  await React.act(async () => { finish('anna@example.ru:secret') })
  expect(done).toHaveBeenCalledTimes(1)
  expect(box.textContent).not.toContain('Вход отменён')
})
