// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { captureLoginReturn, gatekeeperLoginHref, loginReturnError, resetLoginReturnForTests } from './loginReturn'
import { useAuth } from '../useAuth'

// Вход на той же странице, клиентская половина: приложение возвращается от гейткипера с
// #login=<код>, убирает код из адреса и меняет его на ключ сеанса по RPC.

const CODE = 'k'.repeat(43)
let root: Root, box: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  resetLoginReturnForTests()
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
})
afterEach(async () => {
  await React.act(async () => root.unmount()); box.remove()
  localStorage.clear(); window.history.replaceState(null, '', '/')
})

function publicApi(exchange: (code: string) => Promise<string>) {
  return {
    completeGatekeeperLogin: vi.fn(exchange),
    authenticate: vi.fn((_token: string) => ({ [Symbol.dispose]() {} })),
  }
}
function Probe({ api, seen }: { api: ReturnType<typeof publicApi>; seen: { authenticated: boolean; loading: boolean }[] }) {
  const auth = useAuth(api as never)
  seen.push({ authenticated: auth.isAuthenticated, loading: auth.isLoading })
  return null
}

it('адрес входа ведёт на /api/login/start с исходным путём, без фрагмента', () => {
  window.history.replaceState(null, '', '/gatekeepers/mnemos?tab=2#invite')
  expect(gatekeeperLoginHref('mnemos')).toBe('/api/login/start?vendor=mnemos&return_to=%2Fgatekeepers%2Fmnemos%3Ftab%3D2')
})

it('возврат с кодом: код убирается из адреса, меняется на ключ один раз, ключ — в localStorage, человек вошёл', async () => {
  window.history.replaceState(null, '', `/gatekeepers/mnemos#login=${CODE}`)
  const api = publicApi(async () => 'anna@example.ru:secret')
  const seen: { authenticated: boolean; loading: boolean }[] = []
  captureLoginReturn()
  expect(window.location.hash).toBe('')
  expect(window.location.pathname).toBe('/gatekeepers/mnemos')
  await React.act(async () => root.render(<React.StrictMode><Probe api={api} seen={seen} /></React.StrictMode>))
  expect(api.completeGatekeeperLogin).toHaveBeenCalledTimes(1)
  expect(api.completeGatekeeperLogin).toHaveBeenCalledWith(CODE)
  expect(localStorage.getItem('authToken')).toBe('anna@example.ru:secret')
  expect(api.authenticate).toHaveBeenLastCalledWith('anna@example.ru:secret')
  expect(seen.at(-1)).toEqual({ authenticated: true, loading: false })
})

it('отказ обмена (повтор, чужой браузер, истёкший код): человек не вошёл, видна причина', async () => {
  window.history.replaceState(null, '', `/#login=${CODE}`)
  const api = publicApi(async () => { throw new Error('Login rejected') })
  const seen: { authenticated: boolean; loading: boolean }[] = []
  await React.act(async () => root.render(<Probe api={api} seen={seen} />))
  expect(localStorage.getItem('authToken')).toBeNull()
  expect(api.authenticate).not.toHaveBeenCalled()
  expect(seen.at(-1)).toEqual({ authenticated: false, loading: false })
  expect(loginReturnError()).toMatch(/устарела|другом браузере/)
  expect(window.location.hash).toBe('')
})

it('возврат с причиной отказа: обмена нет, причина показывается по-русски', async () => {
  window.history.replaceState(null, '', '/#login-error=signups_disabled')
  const api = publicApi(async () => 'x:y')
  await React.act(async () => root.render(<Probe api={api} seen={[]} />))
  expect(api.completeGatekeeperLogin).not.toHaveBeenCalled()
  expect(loginReturnError()).toMatch(/закрыта/)
  expect(window.location.hash).toBe('')
})

it('ключ сеанса никогда не попадает в адрес', async () => {
  window.history.replaceState(null, '', `/#login=${CODE}`)
  const api = publicApi(async () => 'anna@example.ru:secret')
  await React.act(async () => root.render(<Probe api={api} seen={[]} />))
  expect(window.location.href).not.toContain('secret')
})

it('посторонний фрагмент не трогается', () => {
  window.history.replaceState(null, '', '/gatekeepers/mnemos#invite')
  expect(captureLoginReturn()).toBeNull()
  expect(window.location.hash).toBe('#invite')
})

it('возврат после входа, начатого в другой вкладке или браузере: причина понятна и говорит, что делать', async () => {
  window.history.replaceState(null, '', '/#login-error=other_tab')
  const api = publicApi(async () => 'x:y')
  await React.act(async () => root.render(<Probe api={api} seen={[]} />))
  expect(api.completeGatekeeperLogin).not.toHaveBeenCalled()
  expect(loginReturnError()).toBe('Вход был начат в другой вкладке или другом браузере. Нажмите «Войти» ещё раз здесь.')
})
