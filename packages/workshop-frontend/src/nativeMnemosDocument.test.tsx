// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { NativeMnemosBinding, NativeMnemosCreation, NativeMnemosState } from '@gadgets/workshop-shared/native-document'
import DocumentStatus from './DocumentStatus'
import { createMnemosDocument, officeFilename, type WritesSource } from './nativeMnemosDocument'

const { api } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<Disposable>>(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return { [Symbol.dispose]() {} } }) } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const HEAD = 'a'.repeat(64)
const snapshot = { format: 'cloudflareos.document' as const, formatVersion: 1 as const,
  document: { revision: 5, title: 'Новый документ', blocks: [{ id: 'b1', html: '<h1>Статус проекта</h1>' }, { id: 'b2', html: '<p>Сроки держим.</p>' }] } }

/** Mnemos глазами браузера: создание, повтор по квитанции и адрес созданного документа. */
function fakeMnemos(log: string[]) {
  class Writer extends RpcTarget {
    async head() { return HEAD }
    async recoveryState() { return { head: HEAD, uploadId: 'upload' } }
    async issue(_head: string, size: number, checksum: string) {
      log.push('issue')
      return { upload_id: 'upload', url: 'https://objects.example/native', method: 'PUT', checksum_header: 'x-amz-checksum-sha256', checksum_value: checksum, content_length: size }
    }
    async checkpoint() { log.push('checkpoint'); return 'receipt-1' }
    async save() { log.push('save'); return 'b'.repeat(64) }
    async document() { return 'created-doc' }
  }
  class Selector extends RpcTarget {
    async create(scope: string, name: string, format: string) { log.push(`create:${scope}:${name}:${format}`); return new RpcStub(new Writer()) }
    async resumeCreation(receipt: string) { log.push(`resume:${receipt}`); return new RpcStub(new Writer()) }
    async reviewerIdentity() { return 'alice' }
    async publicationState() { return { personal_head: HEAD, shared_head: '', personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async participants() { return { head: HEAD, nextCursor: '', participants: [] } }
    async scopes() { return { scopes: [{ id: 'project', name: 'Продажи' }] } }
    async documents() { return { documents: [{ id: 'created-doc', name: 'Статус проекта' }], nextCursor: '', truncated: false } }
  }
  return new Selector()
}

async function stubUpload() {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
}

it('создание: квитанция записывается до отправки, редактор привязывается к созданному документу с ревизией снимка', async () => {
  await stubUpload()
  const log: string[] = []
  const gadget = {
    claimMnemosDocument: vi.fn(async (accountId: number, scope: string, name: string): Promise<NativeMnemosCreation> => { log.push('claim'); return { claim: 'c1', accountId, scope, name, at: 1 } }),
    recordMnemosDocumentReceipt: vi.fn(async (claim: string, receipt: string) => { log.push(`receipt:${claim}:${receipt}`) }),
    setMnemosDocument: vi.fn(async (_binding: NativeMnemosBinding | null) => { log.push('bind') }),
  }
  const writes: WritesSource = { selector: new RpcStub(fakeMnemos(log)) as unknown as WritesSource['selector'], storageOrigin: 'https://objects.example' }
  const binding = await createMnemosDocument({ gadget: gadget as never, writes, format: 'cloudflareos.document', snapshotSource: { current: async () => snapshot },
    accountId: 1, scope: 'project', name: 'Статус проекта', signal: new AbortController().signal })
  expect(binding).toEqual({ accountId: 1, scope: 'project', resource: 'created-doc', savedRevision: 5, savedHead: 'b'.repeat(64) })
  expect(log).toEqual(['claim', 'create:project:Статус проекта:cloudflareos.document', 'issue', 'checkpoint', 'receipt:c1:receipt-1', 'save', 'bind'])
  expect(gadget.setMnemosDocument).toHaveBeenCalledWith(binding)
})

it('вторая вкладка не создаёт второй документ, а вкладка после сбоя повторяет ту же заявку', async () => {
  const log: string[] = []
  const writes: WritesSource = { selector: new RpcStub(fakeMnemos(log)) as unknown as WritesSource['selector'], storageOrigin: 'https://objects.example' }
  const busy = { claimMnemosDocument: vi.fn(async () => null), recordMnemosDocumentReceipt: vi.fn(), setMnemosDocument: vi.fn() }
  expect(await createMnemosDocument({ gadget: busy as never, writes, format: 'cloudflareos.document', snapshotSource: { current: async () => snapshot },
    accountId: 1, scope: 'project', name: 'Статус проекта', signal: new AbortController().signal })).toBeNull()
  expect(log).toEqual([])
  const resumed = { claimMnemosDocument: vi.fn(), recordMnemosDocumentReceipt: vi.fn(), setMnemosDocument: vi.fn(async () => {}) }
  const binding = await createMnemosDocument({ gadget: resumed as never, writes, format: 'cloudflareos.document', snapshotSource: { current: async () => { throw new Error('снимок не нужен') } },
    accountId: 1, scope: 'project', name: 'Статус проекта', resume: { claim: 'c1', accountId: 1, scope: 'project', name: 'Статус проекта', receipt: 'receipt-1', at: 1 }, signal: new AbortController().signal })
  expect(binding).toEqual({ accountId: 1, scope: 'project', resource: 'created-doc' })
  expect(log).toEqual(['resume:receipt-1', 'save'])
  expect(resumed.claimMnemosDocument).not.toHaveBeenCalled()
})

function gadgetWith(state: NativeMnemosState, log: string[]) {
  class Gadget extends RpcTarget {
    async getId() { return 'doc-gadget' }
    async getTitle() { return 'Статус Mnemos — генератор' }
    async getMnemosDocument() { return state }
    async ensureNativeDocumentTitle() { log.push('title'); snapshot.document.title = 'Статус проекта'; return 'Статус проекта' }
    async claimMnemosDocument(accountId: number, scope: string, name: string) { log.push(`claim:${name}`); return { claim: 'c1', accountId, scope, name, at: 1 } }
    async recordMnemosDocumentReceipt() { log.push('receipt') }
    async setMnemosDocument(binding: NativeMnemosBinding | null) { log.push(`bind:${binding?.resource}`) }
  }
  return new RpcStub(new Gadget()) as unknown as RpcStub<GadgetClient>
}

it('документ из беседы с проектом сам сохраняется в первый проект под своим названием, и шапка показывает версию', async () => {
  await stubUpload()
  const log: string[] = []
  snapshot.document.title = 'Новый документ'
  api.getGatekeeperApp.mockImplementation(async () => ({ ui: {}, iframeHtml: '', nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(fakeMnemos(log)) } }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<DocumentStatus gadget={gadgetWith({ binding: null, creation: null, project: { accountId: 1, projectId: 'project', title: 'Продажи' } }, log)}
      format="cloudflareos.document" snapshotSource={{ current: async () => snapshot }} projectChatId={3} changesPollMs={20} />))
    await act(async () => { await vi.waitFor(() => expect(log).toContain('bind:created-doc'), { timeout: 3000 }) })
    // Название задаётся до создания, и документ в Mnemos называется так же, как в шапке редактора.
    expect(log.slice(0, 3)).toEqual(['title', 'claim:Статус проекта', 'create:project:Статус проекта:cloudflareos.document'])
    expect(log.filter(entry => entry.startsWith('create:'))).toHaveLength(1)
    await act(async () => { await vi.waitFor(() => expect(host.querySelector('[data-document-status]')?.textContent).toContain('Личная версия')) })
    expect(host.textContent).not.toContain('Сохранить в проект…')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('без проекта беседы шапка предлагает «Сохранить в проект…», а пустой документ в Mnemos не уходит', async () => {
  const log: string[] = []
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  api.getGatekeeperApp.mockImplementation(async () => ({ ui: {}, iframeHtml: '', nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(fakeMnemos(log)) } }))
  try {
    await act(async () => root.render(<DocumentStatus gadget={gadgetWith({ binding: null, creation: null, project: null }, log)}
      format="cloudflareos.document" snapshotSource={{ current: async () => ({ ...snapshot, document: { revision: 1, title: 'Новый документ', blocks: [] } }) }} changesPollMs={20} />))
    await act(async () => { await vi.waitFor(() => expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Сохранить в проект…')).toBe(true)) })
    expect(host.querySelector('[data-document-status]')?.textContent).toContain('Не сохранён в Mnemos')
    expect(log.some(entry => entry.startsWith('create:') || entry.startsWith('claim:'))).toBe(false)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('имя файла Word сохраняет кириллицу', () => {
  expect(officeFilename('Статус проекта: сентябрь', 'cloudflareos.document')).toBe('Статус проекта_ сентябрь.docx')
  expect(officeFilename('', 'cloudflareos.presentation')).toBe('Документ.pptx')
})
