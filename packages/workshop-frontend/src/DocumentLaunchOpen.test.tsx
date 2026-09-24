// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import DocumentStatus from './DocumentStatus'

const { api } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<Disposable>>(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return { [Symbol.dispose]() {} } }) } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Открытие из «Входящих» оставляет в сессии адрес документа; рабочее место само открывает эту версию в редакторе.
// Версия приглашённого — из ветки владельца (private:<голова владельца>), своего черновика у него нет.
it('рабочее место само открывает версию, выбранную во «Входящих», без кнопки', async () => {
  const calls: string[] = []
  const version = 'private:' + 'c'.repeat(64)
  class Selector extends RpcTarget {
    async publicationState() { calls.push('publicationState'); return { personal_head: '', shared_head: '', personal_exists: false } }
    async select() { calls.push('select'); throw new Error('no') }
  }
  class Downloads extends RpcTarget {
    async scopes() { calls.push('scopes'); return { scopes: [{ id: 'project', name: 'P' }] } }
    async documents() { calls.push('documents'); return { documents: [], nextCursor: '', truncated: false } }
    async publications() { calls.push('publications'); return { resourceUrl: 'https://memory.example/v1/projects/project/nodes/doc', nextCursor: '', publications: [{ id: version, recordedAt: '', actor: 'owner-user', format: 'cloudflareos.document' }] } }
  }
  class Empty extends RpcTarget {}
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }))
  class Gadget extends RpcTarget {
    async getId() { return 'native-doc' }
    async getMnemosDocument() { return { binding: null, creation: null, project: null } }
    async prepareNativeDocumentRead(...a: unknown[]) { calls.push('prepare ' + JSON.stringify(a)); throw new Error('stop') }
    onRpcBroken() {}
  }
  const gadget = new RpcStub(new Gadget())
  sessionStorage.setItem('mnemos-document-launch:/', JSON.stringify({ accountId: 1, scope: 'project', resource: 'doc', format: 'cloudflareos.document', publication: version, at: Date.now() - 10 }))
  const snapshotSource = { current: async () => ({ format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: 3, title: '', blocks: [] } }) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} />))
  await act(async () => { await vi.waitFor(() => expect(calls.some(c => c.startsWith('prepare'))).toBe(true), { timeout: 3000 }) })
  expect(calls).toContain('prepare ' + JSON.stringify([1, 'https://memory.example/v1/projects/project/nodes/doc', version]))
  expect(container.textContent).toContain('Открытие не подтверждено')
  await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]()
})
