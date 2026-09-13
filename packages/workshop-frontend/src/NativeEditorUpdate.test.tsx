// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import NativeEditorUpdate from './NativeEditorUpdate'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it.each([false, true])('waits for native input persistence before applying code; failed flush=%s', async failed => {
  const applied = vi.fn(), reloaded = vi.fn()
  class Gadget extends RpcTarget {
    async getNativeEditorUpdate() { return { codeVersion: 4, revision: 12, changedFiles: ['client.js'] } }
    async applyNativeEditorUpdate(version: number, revision: number) { applied(version, revision) }
  }
  const stub = new RpcStub(new Gadget())
  let finish!: () => void
  const flush = vi.fn(async () => {
    await new Promise<void>(resolve => { finish = resolve })
    if (failed) throw new Error('unavailable')
    return { format: 'cloudflareos.spreadsheet' as const, formatVersion: 1 as const, document: { revision: 7 } }
  })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  async function click(text: string) {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === text)
    expect(button).toBeDefined()
    await act(async () => { button!.click() })
  }
  try {
    await act(async () => { root.render(<NativeEditorUpdate gadget={stub as RpcStub<GadgetClient>} format="cloudflareos.spreadsheet" snapshotSource={{ current: flush }} onUpdated={reloaded} />) })
    await click('Обновить редактор')
    expect(document.body.textContent).toContain('Собственные изменения его кода будут заменены')
    expect(applied).not.toHaveBeenCalled(); expect(flush).not.toHaveBeenCalled()
    await click('Сохранить ввод и обновить')
    expect(flush).toHaveBeenCalledOnce(); expect(applied).not.toHaveBeenCalled()
    await act(async () => { finish() })
    if (failed) {
      expect(applied).not.toHaveBeenCalled(); expect(reloaded).not.toHaveBeenCalled()
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('не подтверждено')
    } else { expect(applied).toHaveBeenCalledWith(4, 12); expect(reloaded).toHaveBeenCalledOnce() }
  } finally {
    await act(async () => { root.unmount() }); host.remove(); stub[Symbol.dispose]()
  }
})
