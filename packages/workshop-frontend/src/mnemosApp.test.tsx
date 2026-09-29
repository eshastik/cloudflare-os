// @vitest-environment jsdom
// Приложение как файл проекта Mnemos (ADR 0028): открытие как у документа, шапка, общий экземпляр и предпросмотр.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, test, vi } from 'vitest'
import { gadgetAppText, type GadgetAppDocument, type MnemosAppBinding, type MnemosAppState } from '@gadgets/workshop-shared/gadget-app'

const { frames } = vi.hoisted(() => ({ frames: { writes: null as unknown, downloads: null as unknown } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: {} }) }))
vi.mock('./accountCapabilities', () => ({
  listAccounts: async () => [{ id: 7, vendorId: 'mnemos' }],
  storesDocuments: () => true,
  openNativeWritesFrame: async () => ({ iframeHtml: '', ui: {}, nativeWrites: { storageOrigin: 'https://objects.example', selector: frames.writes }, nativeDownloads: { storageOrigin: 'https://objects.example', selector: frames.downloads } }),
}))
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: () => {} }))
const texts = new Map<string, string>()
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperAppText: async (_origin: string, ticket: { url: string }) => texts.get(ticket.url)! }))
const uploads: string[] = []
vi.mock('./gatekeeperAppUpload', () => ({ uploadGatekeeperAppText: async (text: string) => { uploads.push(text); return 'upload-1' } }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { launchNativeDocument } from './nativeDocumentLaunch'
import { readMnemosAppLaunch } from './mnemosAppLaunch'
import { deriveAppStatus, useMnemosApp, type MnemosAppHandle } from './MnemosAppStatus'
const PUBLISHED = 'event-1'

const HEAD = 'a'.repeat(64), NEXT = 'b'.repeat(64)
const DOC: GadgetAppDocument = { manifest: { title: 'Общий список', description: 'Дела отдела', collaborative: true, session: true, formatVersion: 1, permissions: [] }, modules: { 'client.js': 'ui()', 'server.js': 'export class Gadget { session(caller) { return caller } }' } }
const SOLO: GadgetAppDocument = { ...DOC, manifest: { ...DOC.manifest, collaborative: false } }

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/'); texts.clear(); uploads.length = 0 })

test('узел приложения открывается как документ: своё рабочее место с гаджетом, заявка на версию, повтор — то же место', async () => {
  const dispose = vi.fn()
  const gadget = { getId: async () => 5, [Symbol.dispose]: vi.fn() }
  const api = {
    listGadgets: vi.fn(async () => [{ id: 'ws-app' }]), listOutputFormats: vi.fn(), newGadgetFromBlueprint: vi.fn(),
    newGadget: vi.fn(async () => ({ getMetadata: async () => ({ id: 'ws-app' }), createGadget: vi.fn(async () => gadget), [Symbol.dispose]: dispose })),
  }
  const selector = { publications: vi.fn(async () => ({ publications: [{ id: `private:${HEAD}`, format: 'cloudflareos.app' }], resourceUrl: '' })) }
  const navigate = vi.fn(async (id: string) => { history.replaceState(null, '', `/workspace/${id}`) })
  expect(await launchNativeDocument(api as never, selector as never, 7, 'project', 'node', navigate)).toBe(true)
  expect(api.newGadgetFromBlueprint).not.toHaveBeenCalled()
  expect(readMnemosAppLaunch()).toMatchObject({ accountId: 7, scope: 'project', resource: 'node', publication: `private:${HEAD}`, gadgetId: 5 })
  expect(dispose).toHaveBeenCalledOnce()
  await launchNativeDocument(api as never, selector as never, 7, 'project', 'node', navigate)
  expect(api.newGadget).toHaveBeenCalledOnce()
  expect(navigate).toHaveBeenCalledTimes(2)
})

test('шапка: в общем экземпляре — только опубликованное; личная версия — «Опубликовать» у владельца, «Запустить» — только опубликованной и с правкой', () => {
  expect(deriveAppStatus({ access: 'edit', collaborative: true, unsaved: true }).primary?.kind).toBe('save')
  expect(deriveAppStatus({ access: 'read', collaborative: true, unsaved: true })).toMatchObject({ kind: 'readonly', primary: null })
  expect(deriveAppStatus({ access: 'owner', collaborative: true, unsaved: false, savedVersion: `private:${HEAD}`, liveVersion: PUBLISHED }).primary?.kind).toBe('submit')
  expect(deriveAppStatus({ access: 'edit', collaborative: true, unsaved: false, savedVersion: `private:${HEAD}`, liveVersion: PUBLISHED }).primary).toBeNull()
  expect(deriveAppStatus({ access: 'edit', collaborative: true, unsaved: false, savedVersion: 'event-2', liveVersion: PUBLISHED }).primary?.kind).toBe('start')
  expect(deriveAppStatus({ access: 'read', collaborative: true, unsaved: false, savedVersion: 'event-2', liveVersion: PUBLISHED }).primary).toBeNull()
  expect(deriveAppStatus({ access: 'read', collaborative: true, unsaved: false, savedVersion: PUBLISHED, liveError: 'доступ закрыт' })).toMatchObject({ tone: 'danger', saved: 'доступ закрыт' })
  expect(deriveAppStatus({ access: null, collaborative: true, unsaved: false }).kind).toBe('unread')
})

type Deployed = { version: string; sha256: string; title: string; collaborative: boolean } | null
function harness(options: { deployed?: Deployed; access?: 'edit' | 'read'; doc?: GadgetAppDocument } = {}) {
  const doc = options.doc ?? DOC
  let state: MnemosAppState = { binding: null, codeVersion: 1, title: 'Приложение', notExportable: null }
  const calls = { restore: [] as unknown[][], bindings: [] as (MnemosAppBinding | null)[], deploys: [] as [boolean, string][], saves: [] as string[][], downloads: [] as string[], opens: [] as boolean[] }
  const gadget = {
    getId: async () => 5,
    getMnemosApp: async () => state,
    setMnemosApp: async (binding: MnemosAppBinding | null) => { calls.bindings.push(binding); state = { ...state, binding } },
    restoreAppModules: async (modules: unknown, title: string, expected: number) => { calls.restore.push([modules, title, expected]); state = { ...state, codeVersion: expected + 1, title }; return expected + 1 },
    exportAppModules: async () => ({ codeVersion: state.codeVersion, title: state.title, modules: doc.modules }),
    edit: () => { state = { ...state, codeVersion: state.codeVersion + 1 } },
  }
  const instances: Record<'shared' | 'personal', Deployed> = { shared: options.deployed ?? null, personal: null }
  const connect = (personal: boolean) => {
    const kind = personal ? 'personal' : 'shared'
    const connection = {
      describe: async () => ({ access: options.access ?? 'edit', caller: { principal: 'anna', name: 'Анна' }, deployed: instances[kind] }),
      manifest: async () => doc.manifest,
      deploy: async (version: string) => {
        if (!personal && version.startsWith('private:')) throw new Error('только опубликованная')
        calls.deploys.push([personal, version]); instances[kind] = { version, sha256: 'd'.repeat(64), title: 'Общий список', collaborative: !personal }; return connection.describe()
      },
      getUiBundle: async () => ({ jsCode: 'ui()' }), connectToGadget: async () => ({}), [Symbol.dispose]: () => {},
    }
    return connection
  }
  const api = { openMnemosApp: vi.fn(async (_a: number, _s: string, _r: string, personal: boolean) => { calls.opens.push(personal); return connect(personal) }), subscribeConnectedAccounts: vi.fn(), getGatekeeperApp: vi.fn() }
  const writer = { head: async () => HEAD, access: async () => 'owner', issue: async () => ({}), save: async (base: string, upload: string) => { calls.saves.push([base, upload]); return NEXT }, [Symbol.dispose]: () => {} }
  frames.writes = { appAccess: async () => ({ access: options.access ?? 'edit', principal: 'anna', tenant: 'org', name: 'Анна', project: 'project', node: 'node' }), select: async () => writer }
  frames.downloads = { select: async (_scope: string, _resource: string, version: string) => { calls.downloads.push(version); return { issue: async () => ({ url: version, content_type: 'application/vnd.cloudflareos.app+json' }), validate: async () => {}, [Symbol.dispose]: () => {} } } }
  texts.set(PUBLISHED, gadgetAppText(doc)); texts.set(`private:${HEAD}`, gadgetAppText(doc))
  return { gadget, api, calls, instances }
}

async function mount(h: ReturnType<typeof harness>, previewChatId?: number) {
  const out: { current: MnemosAppHandle | null } = { current: null }
  function Probe({ chat }: { chat?: number }) { out.current = useMnemosApp({ api: h.api as never, gadget: h.gadget as never, previewChatId: chat, pollMs: 0 }); return null }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe chat={previewChatId} />))
  return { out, rerender: (chat?: number) => act(async () => root.render(<Probe chat={chat} />)), unmount: () => act(async () => root.unmount()) }
}
const launch = (publication: string) => {
  history.replaceState(null, '', '/workspace/ws-app')
  sessionStorage.setItem('mnemos-app-launch:/workspace/ws-app', JSON.stringify({ accountId: 7, scope: 'project', resource: 'node', publication, gadgetId: 5, at: Date.now() }))
}

test('с правом правки: код опубликованной версии встаёт в гаджет, пустой общий экземпляр поднимается этой версией (код читает оболочка)', async () => {
  launch(PUBLISHED)
  const h = harness()
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget).not.toBeNull()) })
  expect(h.calls.restore).toEqual([[DOC.modules, 'Общий список', 1]])
  expect(h.calls.bindings.at(-1)).toMatchObject({ accountId: 7, collaborative: true, session: true, description: 'Дела отдела', savedCodeVersion: 2, savedVersion: PUBLISHED })
  expect(h.calls.deploys).toEqual([[false, PUBLISHED]])
  expect(readMnemosAppLaunch()).toBeNull()
  await unmount()
})

test('личную версию открытие в общий экземпляр не запускает: у автора — предпросмотр', async () => {
  launch(`private:${HEAD}`)
  const h = harness({ deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(h.calls.bindings.length).toBeGreaterThan(0)) })
  await act(async () => { await vi.waitFor(() => expect(out.current?.live).not.toBeNull()) })
  expect(h.calls.deploys).toEqual([])
  expect(out.current?.showWorkspace).toBe(true)
  expect(out.current?.liveGadget).toBeNull()
  await unmount()
})

test('без права правки: код не скачивается и не кладётся в рабочее место, виден только экран общего экземпляра', async () => {
  launch(PUBLISHED)
  const h = harness({ access: 'read', deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget).not.toBeNull()) })
  expect(h.calls.restore).toEqual([])
  expect(h.calls.downloads).toEqual([])
  expect(h.calls.bindings.at(-1)?.savedCodeVersion).toBeUndefined()
  expect(out.current?.hasCode).toBe(false)
  await unmount()
})

test('правки и беседа с предложенными изменениями — предпросмотр: общий экземпляр не подключается', async () => {
  const h = harness({ deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  await h.gadget.setMnemosApp({ accountId: 7, scope: 'project', resource: 'node', description: '', collaborative: true, session: true, permissions: [], savedCodeVersion: 1, savedVersion: PUBLISHED })
  const { out, rerender, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget).not.toBeNull()) })
  await rerender(3)
  expect(out.current?.liveGadget).toBeNull()
  expect(out.current?.model?.primary?.kind).toBe('save')
  await rerender(undefined)
  expect(out.current?.liveGadget).not.toBeNull()
  await unmount()
})

test('«Сохранить» совместное приложение: личная версия в Mnemos, общий экземпляр не меняется', async () => {
  const h = harness({ deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  await h.gadget.setMnemosApp({ accountId: 7, scope: 'project', resource: 'node', description: 'Дела отдела', collaborative: true, session: true, permissions: [], savedCodeVersion: 1, savedHead: HEAD, savedVersion: PUBLISHED })
  h.gadget.edit()
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.access).toBe('owner')) })
  await act(async () => { await out.current!.save() })
  expect(h.calls.saves).toEqual([[HEAD, 'upload-1']])
  expect(uploads).toEqual([gadgetAppText({ ...DOC, manifest: { ...DOC.manifest, title: 'Приложение' } })])
  expect(h.calls.bindings.at(-1)).toMatchObject({ savedCodeVersion: 2, savedHead: NEXT, savedVersion: `private:${NEXT}` })
  expect(h.calls.deploys).toEqual([])
  expect(out.current?.model?.primary?.kind).toBe('submit')
  await unmount()
})

test('«Сохранить» личное приложение: новая версия работает в своём экземпляре', async () => {
  const h = harness({ doc: SOLO })
  await h.gadget.setMnemosApp({ accountId: 7, scope: 'project', resource: 'node', description: '', collaborative: false, session: true, permissions: [], savedCodeVersion: 1, savedHead: HEAD, savedVersion: `private:${HEAD}` })
  h.gadget.edit()
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.access).toBe('owner')) })
  await act(async () => { await out.current!.save() })
  expect(h.calls.deploys).toEqual([[true, `private:${NEXT}`]])
  await unmount()
})
