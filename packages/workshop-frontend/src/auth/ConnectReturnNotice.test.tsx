// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const toasts = vi.hoisted(() => ({ add: vi.fn<(toast: { title: string; variant: string }) => void>() }))
// Как настоящий менеджер: новый объект на каждый рендер.
vi.mock('@cloudflare/kumo', () => ({ useKumoToastManager: () => ({ add: toasts.add }) }))

import ConnectReturnNotice from './ConnectReturnNotice'
import { resetConnectReturnForTests } from './accountConnect'

let root: Root, box: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  resetConnectReturnForTests(); toasts.add.mockReset()
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
})
afterEach(async () => { await React.act(async () => root.unmount()); box.remove(); window.history.replaceState(null, '', '/') })

it('после возврата из подключения код меняется в сеансе и человек видит итог', async () => {
  window.history.replaceState(null, '', `/gatekeepers#connect=${'c'.repeat(43)}`)
  const api = { completeConnect: vi.fn(async () => ({ kind: 'connect' as const, vendorId: 'google', accountId: 2 })) }
  await React.act(async () => root.render(<ConnectReturnNotice api={api as never} />))
  expect(api.completeConnect).toHaveBeenCalledWith('c'.repeat(43))
  expect(toasts.add).toHaveBeenCalledWith({ title: 'Аккаунт подключён.', variant: 'success' })
  // Перерисовки (новый менеджер уведомлений каждый раз) не повторяют сообщение.
  await React.act(async () => root.render(<ConnectReturnNotice api={api as never} />))
  await React.act(async () => root.render(<ConnectReturnNotice api={api as never} />))
  expect(toasts.add).toHaveBeenCalledTimes(1)
})

it('отказ — сообщение об ошибке; без возврата — тишина', async () => {
  window.history.replaceState(null, '', '/#connect-error=other_tab')
  await React.act(async () => root.render(<ConnectReturnNotice api={{} as never} />))
  expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))

  resetConnectReturnForTests(); toasts.add.mockReset()
  window.history.replaceState(null, '', '/gatekeepers')
  await React.act(async () => root.render(<ConnectReturnNotice api={{} as never} key="again" />))
  expect(toasts.add).not.toHaveBeenCalled()
})
