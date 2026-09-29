// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { AccountChooser } from './AccountChooser'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
testGlobal.IS_REACT_ACT_ENVIRONMENT = true

function render(resourceTitle: string, resourceUrlPattern: string): string {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(
    <AccountChooser
      accounts={[]} selectedAccountId={null} vendorId="email" vendorName="Почта"
      resourceTitle={resourceTitle} resourceUrlPattern={resourceUrlPattern}
      connecting={false} reconnectingAccountId={null}
      onSelect={() => {}} onConnect={() => {}} onReconnect={() => {}}
    />,
  ))
  const text = host.textContent ?? ''
  act(() => root.unmount())
  return text
}

it('почтовый ящик узнаётся по адресу ресурса при любом его названии', () => {
  expect(render('Любое название', 'https://mail.example/mailbox/:user')).toContain('Подключить почтовые ящики')
  expect(render('Почтовый ящик', 'https://mail.example/other')).toContain('Подключить Почта')
})
