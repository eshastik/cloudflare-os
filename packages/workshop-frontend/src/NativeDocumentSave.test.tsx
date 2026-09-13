// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import NativeDocumentSave from './NativeDocumentSave'

const { api } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn(), subscribeConnectedAccounts: vi.fn() } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each(['existing', 'new-retry', 'new-reload', 'legacy-reload'])('saves native bytes through the real dialog: %s', async scenario => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
  vi.stubGlobal('crypto', webcrypto)
  const snapshot = { format: 'cloudflareos.document' as const, formatVersion: 1 as const,
    document: { revision: 7, title: 'Команда', blocks: [{ id: 'one', html: '<p><b>Привет</b></p>' + ' '.repeat(270000) }] } }
  let saves = 0, selections = 0, disposed = 0
  class Writer extends RpcTarget {
    async head() { return 'a'.repeat(64) }
    async recoveryState() { return { head: 'a'.repeat(64), uploadId: 'native-upload' } }
    async issue(head: string, size: number, checksum: string) {
      expect(head).toBe('a'.repeat(64)); expect(size).toBeGreaterThan(262144)
      return { upload_id: 'native-upload', url: 'https://objects.example/native', method: 'PUT',
        checksum_header: 'x-amz-checksum-sha256', checksum_value: checksum, content_length: size }
    }
    async checkpoint(head: string, upload: string) {
      expect([head, upload]).toEqual(['a'.repeat(64), 'native-upload'])
      return 'account-bound-receipt'
    }
    async save(head: string, upload: string) {
      if (scenario !== 'existing') {
        expect(sessionStorage.getItem('mnemos-native-create:/:native-doc:cloudflareos.document')).toBe('account-bound-receipt')
        expect(sessionStorage.getItem('mnemos-native-create:/:native-doc:cloudflareos.document:account')).toBe('11')
      }
      expect([head, upload]).toEqual(['a'.repeat(64), 'native-upload']); saves++
      if (scenario !== 'existing' && saves === 1) throw new Error('response lost')
      return 'b'.repeat(64)
    }
  }
  class Selector extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Команда' }] } }
    async documents(scope: string, cursor: string) {
      expect([scope, cursor]).toEqual(['project', ''])
      return { documents: [{ id: 'doc', name: 'План' }], nextCursor: '', truncated: false }
    }
    async select(scope: string, resource: string, format: string) {
      expect([scope, resource, format]).toEqual(['project', 'doc', 'cloudflareos.document']); selections++
      return new RpcStub(new Writer())
    }
    async create(scope: string, name: string, format: string) {
      expect([scope, name, format]).toEqual(['project', 'Новый план', 'cloudflareos.document']); selections++
      return new RpcStub(new Writer())
    }
    async resumeCreation(receipt: string, format: string) {
      expect([receipt, format]).toEqual(['account-bound-receipt', 'cloudflareos.document'])
      return new RpcStub(new Writer())
    }
    [Symbol.dispose]() { disposed++ }
  }
  class Gadget extends RpcTarget { async getId() { return 'native-doc' } async connectToGadget() { throw new Error('Must request flushed client data') } }
  const snapshotSource = { current: vi.fn(async () => snapshot) }
  class Empty extends RpcTarget {}
  api.subscribeConnectedAccounts.mockImplementation(async subscriber => {
    subscriber.add(2, { displayName: 'First organization' }, null, [], true, 'mnemos')
    subscriber.add(11, { displayName: 'Second organization' }, null, [], true, 'mnemos')
    subscriber.ready()
    return new RpcStub(new Empty())
  })
  api.getGatekeeperApp.mockImplementation(async (id, accountId) => {
    expect(id).toBe('mnemos')
    expect(accountId).toBe(11)
    return { ui: new RpcStub(new Empty()), iframeHtml: '', nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) } }
  })
  const request = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error'); expect(init.method).toBe('PUT')
    expect(JSON.parse(new TextDecoder().decode(init.body as Uint8Array))).toEqual(snapshot)
    return new Response(null, { status: 200 })
  })
  vi.stubGlobal('fetch', request)
  const container = document.createElement('div'); document.body.append(container)
  let root = createRoot(container)
  const gadget = new RpcStub(new Gadget())
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)
    expect(button).toBeDefined(); await act(async () => button!.click())
  }
  const choose = async (label: string, value: string) => {
    const select = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
    await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  try {
    await act(async () => root.render(<NativeDocumentSave gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} />))
    await click('Сохранить в Mnemos')
    await choose('Подключение для сохранения Mnemos', '11')
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('option[value="project"]')).not.toBeNull()) })
    await choose('Проект Mnemos', 'project')
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('option[value="doc"]')).not.toBeNull()) })
    if (scenario !== 'existing') {
      await choose('Документ Mnemos', '__new__')
      const input = document.querySelector('input[aria-label="Имя нового документа"]') as HTMLInputElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Новый план')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    } else await choose('Документ Mnemos', 'doc')
    if (scenario === 'existing') await act(async () => { await vi.waitFor(() => expect(selections).toBe(1)) })
    expect(saves).toBe(0)
    await click(scenario === 'existing' ? 'Заменить в личном черновике' : 'Создать в личном черновике')
    await act(async () => { await vi.waitFor(() => expect(saves).toBe(1)) })
    if (scenario !== 'existing') {
      expect(document.body.textContent).toContain('Создание не подтверждено')
      if (scenario === 'new-reload' || scenario === 'legacy-reload') {
        if (scenario === 'legacy-reload') sessionStorage.removeItem('mnemos-native-create:/:native-doc:cloudflareos.document:account')
        await act(async () => root.unmount())
        root = createRoot(container)
        await act(async () => root.render(<NativeDocumentSave gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} />))
        await click('Сохранить в Mnemos')
        const account = document.querySelector('select[aria-label="Подключение для сохранения Mnemos"]') as HTMLSelectElement
        if (scenario === 'legacy-reload') {
          expect(account.value).toBe(''); expect(account.disabled).toBe(false)
          await choose('Подключение для сохранения Mnemos', '11')
        } else { expect(account.value).toBe('11'); expect(account.disabled).toBe(true) }
        await act(async () => { await vi.waitFor(() => expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Продолжить создание')?.disabled).toBe(false)) })
        await click('Продолжить создание')
      } else await click('Создать в личном черновике')
    }
    expect(selections).toBe(1)
    expect(document.body.textContent).toContain('Снимок сохранён в личном черновике.')
    expect(saves).toBe(scenario === 'existing' ? 1 : 2); expect(request).toHaveBeenCalledOnce(); expect(snapshotSource.current).toHaveBeenCalledOnce()
    await click('Закрыть')
    await vi.waitFor(() => expect(disposed).toBe(scenario.endsWith('reload') ? 2 : 1))
  } finally { await act(async () => root.unmount()); gadget[Symbol.dispose](); container.remove() }
})
