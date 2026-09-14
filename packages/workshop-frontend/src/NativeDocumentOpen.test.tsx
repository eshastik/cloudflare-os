// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import NativeDocumentOpen from './NativeDocumentOpen'
import type { GadgetClient } from '@gadgets/workshop-shared/api'

vi.mock('./AuthContext', () => {
  const context = { authenticatedApi: {} }
  return { useAuthenticatedApi: () => context }
})
vi.mock('./gatekeeperAppDownload', () => ({
  downloadGatekeeperNativeDocument: async (_origin: string, _ticket: object, _format: string, signal: AbortSignal, validate: () => Promise<void>) => {
    await validate(); signal.throwIfAborted()
    return { format: 'cloudflareos.spreadsheet', formatVersion: 1, document: { revision: 1, sheets: [] } }
  },
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it.each(['restart', 'restart_probe', 'changed', 'revoked', 'restore'] as const)('native open preserves the read/restore boundary: %s', async mode => {
  let prepared = false
  const calls: string[] = [], restored = vi.fn(), reconnect = vi.fn()
  let finishBinding!: () => void
  const binding = new Promise<void>(resolve => { finishBinding = resolve })
  const onOpened = vi.fn(async () => { await binding })
  class Download extends RpcTarget {
    async issue() { calls.push('issue'); return { url: 'https://example.test/body', method: 'GET', size_bytes: 1, sha256_hex: '0'.repeat(64), content_type: 'application/json' } }
    async validate() { calls.push('validate'); if (mode === 'revoked') throw new Error('denied') }
  }
  class Editor extends RpcTarget {
    async restoreDocumentSnapshot(snapshot: object, revision: number) { calls.push('restore'); restored(snapshot, revision) }
  }
  class Gadget extends RpcTarget {
    async getId() { if (prepared && mode === 'restart_probe') throw new Error('context ended'); return 7 }
    async prepareNativeDocumentRead(account: number, url: string, event: string) {
      calls.push('prepare'); expect([account, url, event]).toEqual([3, 'https://example.test/document', 'publication'])
      prepared = true
      return { sourceId: 9, restartRequired: mode.startsWith('restart') }
    }
    async readNativeDocument(id: number): ReturnType<GadgetClient['readNativeDocument']> {
      calls.push('read'); expect(id).toBe(9)
      return { storageOrigin: 'https://example.test', download: new RpcStub(new Download()) as Awaited<ReturnType<GadgetClient['readNativeDocument']>>['download'] }
    }
    async connectToGadget(): Promise<RpcStub<any>> { calls.push('connect'); return new RpcStub(new Editor()) }
  }
  const stub = new RpcStub(new Gadget())
  let disconnected!: () => void
  const onRpcBroken = vi.fn((callback: () => void) => { disconnected = callback })
  const key = `mnemos-native-open:${location.pathname}:7`
  sessionStorage.setItem(key, JSON.stringify({ accountId: 3, resourceUrl: 'https://example.test/document', publication: 'publication', revision: 4, label: 'Fixture', scope: 'project', resource: 'document', format: 'cloudflareos.spreadsheet', at: Date.now() }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const flush = async () => { calls.push('flush'); return { format: 'cloudflareos.spreadsheet' as const, formatVersion: 1 as const, document: { revision: mode === 'changed' ? 5 : 4 } } }
  try {
    await act(async () => { root.render(<NativeDocumentOpen gadget={{ getId: stub.getId, prepareNativeDocumentRead: stub.prepareNativeDocumentRead, readNativeDocument: stub.readNativeDocument, connectToGadget: stub.connectToGadget, onRpcBroken } as ComponentProps<typeof NativeDocumentOpen>['gadget']} format="cloudflareos.spreadsheet" snapshotSource={{ current: flush }} reconnect={reconnect} onOpened={onOpened} />) })
    expect(document.body.textContent).toContain('Продолжить открытие: Fixture')
    expect(calls).toEqual([])
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Заменить содержимое редактора')
    expect(button).toBeDefined()
    await act(async () => { button!.click() })
    if (mode.startsWith('restart')) {
      expect(calls).toEqual(['flush', 'prepare']); expect(reconnect).not.toHaveBeenCalled()
      expect(onRpcBroken).toHaveBeenCalledOnce()
      await act(async () => {
        if (mode === 'restart_probe') await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce(), { timeout: 500, interval: 20 })
        else disconnected()
      })
      expect(reconnect).toHaveBeenCalledOnce()
      expect(JSON.parse(sessionStorage.getItem(key)!).sourceId).toBe(9)
    } else if (mode === 'changed') {
      expect(calls).toEqual(['flush']); expect(reconnect).not.toHaveBeenCalled()
    } else if (mode === 'revoked') {
      expect(calls).toEqual(['flush', 'prepare', 'read', 'issue', 'validate']); expect(reconnect).not.toHaveBeenCalled()
    } else {
      expect(calls).toEqual(['flush', 'prepare', 'read', 'issue', 'validate', 'connect', 'validate', 'restore'])
      expect(restored).toHaveBeenCalledWith(expect.objectContaining({ format: 'cloudflareos.spreadsheet' }), 4)
      expect(onOpened).toHaveBeenCalledWith({ accountId: 3, scope: 'project', resource: 'document' })
      expect(reconnect).not.toHaveBeenCalled()
      await act(async () => { finishBinding() })
      expect(reconnect).toHaveBeenCalledOnce(); expect(sessionStorage.getItem(key)).toBeNull()
    }
    if (mode !== 'restore') expect(restored).not.toHaveBeenCalled()
  } finally {
    await act(async () => { root.unmount() }); host.remove(); stub[Symbol.dispose](); sessionStorage.clear()
  }
})

it.each([[false, false, false], [true, false, false], [false, true, false], [true, true, false], [false, false, true], [true, false, true]])('restores selected version: failure=%s deleted=%s private=%s', async (fail, deleted, privateVersion) => {
  const version=privateVersion?'private:'+ 'a'.repeat(64):'event'
  const { useAuthenticatedApi } = await import('./AuthContext')
  const restore = vi.fn(async (..._args: unknown[]) => { if (fail) throw new Error('head moved'); return { head: 'new-head' } })
  const source = {
    scopes: async () => ({ scopes: [{ id: 'project', name: 'Project' }] }),
    documents: async () => ({ documents: [{ id: 'doc', name: 'Document' }], nextCursor: '', truncated: false }),
    publications: async () => ({ sharedDeleted: deleted, resourceUrl: 'https://example.test/doc', publications: [{ id: version, actor: privateVersion?'':'Agent', onBehalfOf: 'Owner', recordedAt: '2026-09-08', format: 'cloudflareos.spreadsheet' }], nextCursor: '' }),
    [Symbol.dispose]() {},
  }
  Object.assign(useAuthenticatedApi().authenticatedApi, {
    subscribeConnectedAccounts: async (subscriber: any) => {
      await subscriber.add(3, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory')
      await subscriber.ready()
      return { [Symbol.dispose]() {} }
    },
    getGatekeeperApp: async () => ({
      nativeDownloads: { selector: source },
      nativeWrites: { selector: { restorationState: async () => ({ head: 'prepared-head', deleted }), restorePublication: restore, [Symbol.dispose]() {} } },
    }),
  })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)
    expect(button).toBeDefined(); await act(async () => { button!.click() })
  }
  const choose = async (label: string, value: string) => {
    const select = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
    expect(select).not.toBeNull()
    await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  try {
    sessionStorage.clear()
    await act(async () => { root.render(<NativeDocumentOpen gadget={{ getId: async () => 8 } as ComponentProps<typeof NativeDocumentOpen>['gadget']} format="cloudflareos.spreadsheet" snapshotSource={{ current: null }} reconnect={() => {}} />) })
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Подключение Mnemos"]')).not.toBeNull()) })
    await choose('Подключение Mnemos', '3')
    await choose('Проект для открытия', 'project')
    await choose('Документ для открытия', 'doc')
    expect(document.body.textContent?.includes('Документ удалён из общей версии')).toBe(deleted)
    expect(document.body.textContent).toContain(privateVersion?'Личная версия':'Агент Agent от имени Owner')
    await choose('Публикация Mnemos', version)
    await click('Подготовить восстановление в Mnemos')
    expect(restore).not.toHaveBeenCalled()
    await click(deleted ? 'Восстановить удалённый документ' : 'Восстановить содержимое в личной версии')
    expect(restore).toHaveBeenCalledExactlyOnceWith('project', 'doc', version, 'prepared-head', 'cloudflareos.spreadsheet', deleted)
    expect(document.body.textContent).toContain(fail ? 'Восстановление не подтверждено' : 'Содержимое восстановлено в личной версии')
  } finally {
    await act(async () => { root.unmount() }); host.remove(); sessionStorage.clear()
  }
})
