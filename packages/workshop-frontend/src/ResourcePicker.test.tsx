// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'
import ResourcePicker, { type SelectableItem } from './ResourcePicker'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

vi.mock('@cloudflare/kumo', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

// Два сервиса с одинаковым видимым названием: после перевода названия совпадают легко
// («Почта» у встроенного приёма и у внешнего сервиса), а счёт принадлежит ровно одному из них.
it('счёт показывается только у своего сервиса, даже если названия сервисов совпадают', async () => {
  const sameName = { displayName: 'Почта', url: 'https://mail.example' }
  const api = {
    listGatekeeperVendors: vi.fn(async () => [
      { id: 'email', description: sameName, supportedResources: [{ urlPattern: 'https://mail.example/mailbox/:user', title: 'Почтовый ящик', description: '' }] },
      { id: 'other-mail', description: sameName, supportedResources: [{ urlPattern: 'https://other.example/inbox', title: 'Входящие', description: '' }] },
    ]),
    subscribeConnectedAccounts: vi.fn(async (s: ConnectedAccountsSubscriber) => {
      s.add(7, { displayName: 'Ящик отдела', uniqueName: 'otdel', avatar: { url: '' } }, sameName, [], true, 'email')
      s.ready()
      return { [Symbol.dispose]() {} }
    }),
  } as unknown as RpcStub<AuthenticatedApi>

  let items: SelectableItem[] = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ResourcePicker authenticatedApi={api} searchText="" onSelectAccount={() => {}} onItems={i => { items = i }} />)
  })
  await act(async () => { await Promise.resolve() })

  const accounts = items.filter(i => i.type === 'account')
  expect(accounts.map(i => i.type === 'account' && [i.accountId, i.vendorId])).toEqual([[7, 'email']])
  expect(items.filter(i => i.type === 'connect').map(i => i.vendorId).sort()).toEqual(['email', 'other-mail'])
})
