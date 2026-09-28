// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import LoginPage from './LoginPage'
import { loginNavigation, resetLoginReturnForTests } from './auth/loginReturn'

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
  resetLoginReturnForTests()
  assign.mockReset()
  vi.spyOn(loginNavigation, 'assign').mockImplementation(assign)
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
})
afterEach(async () => { await React.act(async () => root.unmount()); box.remove(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })
const buttons = () => [...box.querySelectorAll('button')].map(b => b.textContent?.trim())
const rpc = (_unused?: unknown) => ({})
// Уход к гейткиперу — переход текущей страницы; jsdom его не выполняет, поэтому подменяем.
const assign = vi.fn<(url: string) => void>()

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

it('ссылка-приглашение: «Принять приглашение» уводит эту же страницу на вход Mnemos, без всплывающего окна', async () => {
  window.history.replaceState(null, '', '/gatekeepers/mnemos#invite')
  const open = vi.spyOn(window, 'open')
  await React.act(async () => root.render(<LoginPage rpcStub={rpc() as never} />))
  expect(box.querySelector('h1')?.textContent).toBe('Вас пригласили в Mnemos')
  const accept = [...box.querySelectorAll('button')].find(b => b.textContent === 'Принять приглашение')!
  await React.act(async () => accept.click())
  expect(assign).toHaveBeenCalledWith('/api/login/start?vendor=mnemos&return_to=%2Fgatekeepers%2Fmnemos')
  expect(open).not.toHaveBeenCalled()
})

it('«Войти» уводит эту же страницу на вход и возвращает её на исходный путь', async () => {
  window.history.replaceState(null, '', '/chat/42?x=1')
  const open = vi.spyOn(window, 'open')
  await React.act(async () => root.render(<LoginPage rpcStub={rpc() as never} />))
  await React.act(async () => [...box.querySelectorAll('button')].find(b => b.textContent === 'Войти')!.click())
  expect(assign).toHaveBeenCalledWith('/api/login/start?vendor=mnemos&return_to=%2Fchat%2F42%3Fx%3D1')
  expect(open).not.toHaveBeenCalled()
})

it('после «Назад» из гейткипера (страница из кэша) кнопка снова работает', async () => {
  await React.act(async () => root.render(<LoginPage rpcStub={rpc() as never} />))
  await React.act(async () => [...box.querySelectorAll('button')].find(b => b.textContent === 'Войти')!.click())
  expect(buttons()).toEqual(['Переходим ко входу…'])
  await React.act(async () => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })) })
  expect(buttons()).toEqual(['Войти'])
  expect(box.querySelector('button')!.disabled).toBe(false)
})
