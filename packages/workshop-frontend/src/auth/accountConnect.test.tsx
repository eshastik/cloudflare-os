// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  captureConnectReturn, completeConnectReturn, connectReturnMessage, resetConnectReturnForTests, restoreAfterConnect,
  startAccountConnect,
} from './accountConnect'
import { loginNavigation } from './loginReturn'

// Подключение аккаунта на той же странице: POST /api/connect/start с ключом сеанса, уход к
// гейткиперу, возврат с #connect=<код>, обмен кода в сеансе. Состояние окна, из которого начали,
// переживает уход и восстанавливается после возврата.

const CODE = 'c'.repeat(43)
let assign: ReturnType<typeof vi.fn<(url: string) => void>>
beforeEach(() => {
  resetConnectReturnForTests()
  sessionStorage.clear(); localStorage.clear()
  localStorage.setItem('authToken', 'anna:secret')
  assign = vi.fn<(url: string) => void>()
  vi.spyOn(loginNavigation, 'assign').mockImplementation(assign)
  window.history.replaceState(null, '', '/gatekeepers?tab=2')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function server(response: unknown, status = 200) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('подключение уводит эту же страницу к гейткиперу; запрос — с ключом сеанса и исходным адресом', async () => {
  const fetch = server({ url: 'https://os.example/gatekeeper/google/abc/def' })
  const open = vi.spyOn(window, 'open')
  expect(await startAccountConnect({ kind: 'connect', vendorId: 'google', resourceUrlPatterns: ['gmail://*'] })).toBe('navigating')
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/connect/start')
  expect(init?.method).toBe('POST')
  expect(init?.credentials).toBe('same-origin')
  expect(init?.headers).toBeDefined()
  expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer anna:secret')
  expect(JSON.parse(String(init?.body))).toEqual({ kind: 'connect', vendorId: 'google', resourceUrlPatterns: ['gmail://*'], returnTo: '/gatekeepers?tab=2' })
  expect(assign).toHaveBeenCalledWith('https://os.example/gatekeeper/google/abc/def')
  expect(open).not.toHaveBeenCalled()
})

it('расширение доступа без действий в браузере — страница никуда не уходит', async () => {
  server({ done: true })
  expect(await startAccountConnect({ kind: 'resources', accountId: 3, resourceUrlPatterns: ['gmail://*'] })).toBe('done')
  expect(assign).not.toHaveBeenCalled()
})

it('отказ сервера — ошибка с его текстом, страница остаётся', async () => {
  server({ error: 'Сеанс истёк. Войдите снова.' }, 401)
  await expect(startAccountConnect({ kind: 'reconnect', accountId: 3 })).rejects.toThrow('Сеанс истёк')
  expect(assign).not.toHaveBeenCalled()
})

it('возврат с кодом: код убирается из адреса, меняется один раз, результат — сообщение', async () => {
  window.history.replaceState(null, '', `/gatekeepers?tab=2#connect=${CODE}`)
  expect(captureConnectReturn()).toEqual({ code: CODE })
  expect(window.location.hash).toBe('')
  expect(window.location.search).toBe('?tab=2')
  const api = { completeConnect: vi.fn(async () => ({ kind: 'connect' as const, vendorId: 'google', accountId: 4 })) }
  const [first, second] = await Promise.all([completeConnectReturn(api as never), completeConnectReturn(api as never)])
  expect(api.completeConnect).toHaveBeenCalledTimes(1)
  expect(api.completeConnect).toHaveBeenCalledWith(CODE)
  expect(first).toEqual({ ok: true, result: { kind: 'connect', vendorId: 'google', accountId: 4 } })
  expect(second).toBe(first)
  expect(connectReturnMessage(first!)).toBe('Аккаунт подключён.')
})

it('отказ обмена и возврат с причиной — понятное сообщение', async () => {
  window.history.replaceState(null, '', `/#connect=${CODE}`)
  const api = { completeConnect: vi.fn(async () => { throw new Error('rejected') }) }
  const failed = await completeConnectReturn(api as never)
  expect(failed).toEqual({ ok: false, reason: 'rejected' })
  expect(connectReturnMessage(failed!)).toMatch(/другом браузере/)

  resetConnectReturnForTests()
  window.history.replaceState(null, '', '/#connect-error=other_tab')
  const other = await completeConnectReturn(api as never)
  expect(api.completeConnect).toHaveBeenCalledTimes(1)
  expect(connectReturnMessage(other!)).toMatch(/другой вкладке/)
  expect(window.location.hash).toBe('')
})

it('состояние окна сохраняется при уходе и отдаётся один раз после возврата на тот же адрес', async () => {
  server({ url: 'https://os.example/gatekeeper/google/abc/def' })
  await startAccountConnect({ kind: 'connect', vendorId: 'google' }, { key: 'resource-picker', state: { query: 'почта', step: 2 } })
  // Возврат: тот же адрес, в нём код.
  window.history.replaceState(null, '', `/gatekeepers?tab=2#connect=${CODE}`)
  resetConnectReturnForTests()
  captureConnectReturn()
  expect(restoreAfterConnect<{ query: string; step: number }>('resource-picker')).toEqual({ query: 'почта', step: 2 })
  expect(restoreAfterConnect('resource-picker')).toBeNull()
})

it('состояние не восстанавливается без возврата из подключения или на другом адресе', async () => {
  server({ url: 'https://os.example/gatekeeper/google/abc/def' })
  await startAccountConnect({ kind: 'connect', vendorId: 'google' }, { key: 'resource-picker', state: { step: 2 } })
  resetConnectReturnForTests()
  window.history.replaceState(null, '', '/gatekeepers?tab=2')
  captureConnectReturn()
  expect(restoreAfterConnect('resource-picker')).toBeNull()
})

it('состояние не восстанавливается при возврате на другой адрес', async () => {
  server({ url: 'https://os.example/gatekeeper/google/abc/def' })
  await startAccountConnect({ kind: 'connect', vendorId: 'google' }, { key: 'resource-picker', state: { step: 2 } })
  window.history.replaceState(null, '', `/elsewhere#connect=${CODE}`)
  resetConnectReturnForTests()
  captureConnectReturn()
  expect(restoreAfterConnect('resource-picker')).toBeNull()
})
