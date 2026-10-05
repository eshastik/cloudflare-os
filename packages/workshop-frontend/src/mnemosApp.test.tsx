// @vitest-environment jsdom
// Приложение как файл проекта Mnemos (ADR 0028): открытие как у документа, шапка, общий экземпляр; код закрыт (п. 4).
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
  openNativeWritesContext: async () => ({accountId: 1, frame: { iframeHtml: '', ui: {}, nativeWrites: { storageOrigin: 'https://objects.example', selector: frames.writes }, nativeDownloads: { storageOrigin: 'https://objects.example', selector: frames.downloads } }}),
}))
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: () => {} }))
const uploads: string[] = []
vi.mock('./gatekeeperAppUpload', () => ({ uploadGatekeeperAppText: async (text: string) => { uploads.push(text); return 'upload-1' } }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { launchNativeDocument } from './nativeDocumentLaunch'
import { readMnemosAppLaunch, rememberMnemosAppLaunch } from './mnemosAppLaunch'
import { deriveAppStatus, useMnemosApp, type MnemosAppHandle } from './MnemosAppStatus'
const PUBLISHED = 'event-1'

const HEAD = 'a'.repeat(64), NEXT = 'b'.repeat(64)
const DOC: GadgetAppDocument = { manifest: { title: 'Общий список', description: 'Дела отдела', collaborative: true, session: true, formatVersion: 1, permissions: [] }, modules: { 'client.js': 'ui()', 'server.js': 'export class Gadget { session(caller) { return caller } }' } }
const SOLO: GadgetAppDocument = { ...DOC, manifest: { ...DOC.manifest, collaborative: false } }

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/'); uploads.length = 0 })

test('узел приложения открывается как документ: своё рабочее место с гаджетом, заявка на версию, повтор — то же место', async () => {
  const dispose = vi.fn()
  const gadget = { getId: async () => 5, [Symbol.dispose]: vi.fn() }
  const api = {
    listGadgets: vi.fn(async () => [{ id: 'ws-app' }]), listOutputFormats: vi.fn(), newGadgetFromBlueprint: vi.fn(),
    newGadget: vi.fn(async () => ({ getMetadata: async () => ({ id: 'ws-app' }), createGadget: vi.fn(async () => gadget), [Symbol.dispose]: dispose })),
  }
  const selector = { publications: vi.fn(async (_scope: string, _resource: string, cursor: string) => ({ publications: cursor ? [{ id: PUBLISHED, format: 'cloudflareos.app' }] : [{ id: `private:${HEAD}`, format: 'cloudflareos.app' }], resourceUrl: '', nextCursor: cursor ? '' : 'published-page' })) }
  const navigate = vi.fn(async (id: string) => { history.replaceState(null, '', `/workspace/${id}`) })
  expect(await launchNativeDocument(api as never, selector as never, 7, 'project', 'node', navigate)).toBe(true)
  expect(api.newGadgetFromBlueprint).not.toHaveBeenCalled()
  expect(readMnemosAppLaunch()).toMatchObject({ accountId: 7, scope: 'project', resource: 'node', publication: PUBLISHED, gadgetId: 5 })
  expect(dispose).toHaveBeenCalledOnce()
  await launchNativeDocument(api as never, selector as never, 7, 'project', 'node', navigate)
  expect(api.newGadget).toHaveBeenCalledOnce()
  expect(navigate).toHaveBeenCalledTimes(2)
})

test('шапка: в общем экземпляре — только опубликованное; личная версия — «Опубликовать» у владельца, «Запустить» — только опубликованной и с правкой', () => {
  expect(deriveAppStatus({ access: 'owner', collaborative: true, savedVersion: `private:${HEAD}`, liveVersion: PUBLISHED }).primary?.kind).toBe('submit')
  expect(deriveAppStatus({ access: 'edit', collaborative: true, savedVersion: `private:${HEAD}`, liveVersion: PUBLISHED }).primary).toBeNull()
  expect(deriveAppStatus({ access: 'edit', collaborative: true, savedVersion: 'event-2', liveVersion: PUBLISHED }).primary?.kind).toBe('start')
  expect(deriveAppStatus({ access: 'read', collaborative: true, savedVersion: 'event-2', liveVersion: PUBLISHED }).primary).toBeNull()
  expect(deriveAppStatus({ access: 'read', collaborative: true, savedVersion: PUBLISHED, liveError: 'доступ закрыт' })).toMatchObject({ tone: 'danger', saved: 'доступ закрыт' })
  expect(deriveAppStatus({ access: null, collaborative: true }).kind).toBe('unread')
  // Подсказка копии не обещает код: получатель получает то же приложение, код ему не показывается.
  const offer = deriveAppStatus({ access: 'read', collaborative: false, offer: { ready: true } })
  expect(offer.primary?.hint).toMatch(/То же приложение/)
  expect(offer.primary?.hint).toMatch(/Код приложения вам не показывается/)
  expect(offer.primary?.hint).not.toMatch(/Тот же код/)
})

type Deployed = { version: string; sha256: string; title: string; collaborative: boolean } | null
function harness(options: { deployed?: Deployed; access?: 'edit' | 'read'; doc?: GadgetAppDocument; restoreFails?: boolean; unpublished?: boolean; accessGate?: Promise<void>; sameSha?: boolean } = {}) {
  const doc = options.doc ?? DOC
  let state: MnemosAppState = { binding: null, codeVersion: 1, title: 'Приложение', notExportable: null }
  const calls = { bindings: [] as (MnemosAppBinding | null)[], deploys: [] as [boolean, string][], downloads: [] as string[], exports: 0, restores: [] as unknown[][], creates: [] as string[], opens: [] as boolean[], previews: 0, previewDeploys: [] as string[] }
  const gadget = {
    getId: async () => 5,
    getMnemosApp: async () => state,
    setMnemosApp: async (binding: MnemosAppBinding | null) => { calls.bindings.push(binding); state = { ...state, binding } },
    exportAppModules: async () => { calls.exports++; if (state.binding) throw new Error('код приложения закрыт'); return { codeVersion: state.codeVersion, title: state.title, modules: doc.modules } },
  }
  const instances: Record<'shared' | 'personal' | 'preview', Deployed> = { shared: options.deployed ?? null, personal: null, preview: null }
  const connect = (personal: boolean, preview = false) => {
    const kind = preview ? 'preview' : personal ? 'personal' : 'shared'
    let disposed = false
    const connection = {
      describe: async () => ({ access: options.access ?? 'edit', caller: { principal: 'anna', name: 'Анна' }, deployed: instances[kind] }),
      manifest: async () => doc.manifest,
      deploy: async (version: string) => {
        if (kind === 'shared' && version.startsWith('private:')) throw new Error('только опубликованная')
        if (kind === 'preview') calls.previewDeploys.push(version); else calls.deploys.push([personal, version])
        instances[kind] = { version, sha256: kind === 'preview' && !options.sameSha ? 'e'.repeat(64) : 'd'.repeat(64), title: 'Общий список', collaborative: !personal }; return connection.describe()
      },
      // Как у Cap'n Web: закрытая связь на вызов отвечает ошибкой.
      getUiBundle: async () => ({ jsCode: 'ui()' }),
      connectToGadget: async () => { if (disposed) throw new Error('Attempted to use RPC stub after it has been disposed.'); return {} },
      [Symbol.dispose]: () => { disposed = true },
    }
    return connection
  }
  const api = { openMnemosApp: vi.fn(async (_a: number, _s: string, _r: string, personal: boolean) => { calls.opens.push(personal); return connect(personal) }),
    openMnemosAppPreview: vi.fn(async () => { calls.previews++; if ((options.access ?? 'edit') === 'read') throw new Error('Предпросмотр личной версии доступен только тем, у кого есть право правки файла.'); return connect(false, true) }),
    subscribeConnectedAccounts: vi.fn(), getGatekeeperApp: vi.fn() }
  const writer = { head: async () => HEAD, access: async () => 'owner', [Symbol.dispose]: () => {} }
  const creator = { head: async () => HEAD, issue: async () => ({}), save: async () => NEXT, document: async () => 'new-node', [Symbol.dispose]: () => {} }
  frames.writes = {
    appAccess: async () => { await options.accessGate; return { access: options.access ?? 'edit', principal: 'anna', tenant: 'org', name: 'Анна', project: 'project', node: 'node' } },
    select: async () => writer,
    create: async (scope: string) => { calls.creates.push(scope); return creator },
    scopes: async () => ({ scopes: [{ id: 'project', name: 'Проект' }] }),
    restorationState: async () => ({ head: HEAD, deleted: false }),
    restorePublication: async (...args: unknown[]) => { calls.restores.push(args); if (options.restoreFails) throw new Error('Draft changed; prepare restoration again'); return { head: NEXT } },
  }
  // Тело версии браузер не читает никогда (ADR 0028, п. 4): выбор версии для скачивания — ошибка теста.
  frames.downloads = {
    select: async (_scope: string, _resource: string, version: string) => { calls.downloads.push(version); throw new Error('код приложения закрыт') },
    publications: async () => ({ publications: [{ id: `private:${NEXT}`, format: 'cloudflareos.app', recordedAt: '', actor: '' }, ...(options.unpublished ? [] : [{ id: PUBLISHED, format: 'cloudflareos.app', recordedAt: '', actor: '' }])], nextCursor: '' }),
  }
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
const bound = (extra: Partial<MnemosAppBinding> = {}): MnemosAppBinding => ({ accountId: 7, scope: 'project', resource: 'node', description: 'Дела отдела', collaborative: true, session: true, permissions: [], savedHead: HEAD, savedVersion: PUBLISHED, ...extra })

test('с правом правки: код не скачивается и в рабочее место не встаёт; манифест читает оболочка, пустой общий экземпляр поднимается этой версией', async () => {
  launch(PUBLISHED)
  const h = harness()
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget).not.toBeNull()) })
  expect(h.calls.downloads).toEqual([])
  expect(h.calls.exports).toBe(0)
  expect(h.calls.bindings.at(-1)).toMatchObject({ accountId: 7, collaborative: true, session: true, description: 'Дела отдела', savedVersion: PUBLISHED })
  expect(h.calls.bindings.at(-1)?.savedCodeVersion).toBeUndefined()
  expect(h.calls.deploys).toEqual([[false, PUBLISHED]])
  expect(out.current?.showWorkspace).toBe(false)
  expect(readMnemosAppLaunch()).toBeNull()
  await unmount()
})

test('повторное «Открыть» в уже открытой панели запускает новую личную версию того же узла', async () => {
  launch(PUBLISHED)
  const h = harness({ doc: SOLO })
  const { out, unmount } = await mount(h)
  try {
    await act(async () => { await vi.waitFor(() => { expect(out.current?.binding?.savedVersion).toBe(PUBLISHED); expect(out.current?.busy).toBe(false) }) })
    await act(async () => {
      rememberMnemosAppLaunch('ws-app', { accountId: 7, scope: 'project', resource: 'node', publication: `private:${NEXT}`, gadgetId: 5 })
    })
    await act(async () => {
      await vi.waitFor(() => expect(out.current?.binding?.savedVersion).toBe(`private:${NEXT}`))
    })
    expect(h.instances.personal?.version).toBe(`private:${NEXT}`)
    expect(h.calls.creates).toEqual([])
    expect(h.calls.downloads).toEqual([])
    expect(readMnemosAppLaunch()).toBeNull()
  } finally { await unmount() }
})

test('заявка из беседы пишется, пока в панели другой гаджет: выполняется, когда откроется её гаджет', async () => {
  launch(PUBLISHED)
  const h = harness()
  const other = { ...h.gadget, getId: async () => 4, setMnemosApp: vi.fn() }
  const out: { current: MnemosAppHandle | null } = { current: null }
  function Probe({ gadget }: { gadget: unknown }) { out.current = useMnemosApp({ api: h.api as never, gadget: gadget as never, pollMs: 0 }); return null }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe gadget={other} />))
  await act(async () => { await Promise.resolve() })
  expect(other.setMnemosApp).not.toHaveBeenCalled()
  expect(readMnemosAppLaunch()).not.toBeNull()
  await act(async () => root.render(<Probe gadget={h.gadget} />))
  await act(async () => { await vi.waitFor(() => expect(h.calls.bindings.at(-1)).toMatchObject({ resource: 'node', savedVersion: PUBLISHED })) })
  expect(readMnemosAppLaunch()).toBeNull()
  await act(async () => root.unmount())
})

test('личная версия совместного узла, право ещё читается: связь наугад не открывается, экран приложения не остаётся на закрытой связи', async () => {
  let allow!: () => void
  const accessGate = new Promise<void>(resolve => { allow = resolve })
  // Общий экземпляр уже работает той же сборкой, что пойдёт в предпросмотр: сумма совпадает.
  const h = harness({ accessGate, sameSha: true, deployed: { version: PUBLISHED, sha256: 'd'.repeat(64), title: 'Общий список', collaborative: true } })
  await h.gadget.setMnemosApp(bound({ savedVersion: `private:${HEAD}` }))
  const seen: NonNullable<MnemosAppHandle['liveGadget']>[] = []
  const out: { current: MnemosAppHandle | null } = { current: null }
  function Probe() { out.current = useMnemosApp({ api: h.api as never, gadget: h.gadget as never, pollMs: 0 }); if (out.current.liveGadget && !seen.includes(out.current.liveGadget)) seen.push(out.current.liveGadget); return null }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(h.calls.opens.filter(personal => !personal)).toEqual([])
  expect(out.current?.liveGadget).toBeNull()
  await act(async () => { allow(); await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(out.current?.liveGadget).not.toBeNull()
  expect(h.calls.previews).toBe(1)
  expect(out.current?.previewMode).toBe(true)
  // Экран, который подключился к связи, держит её, пока ключ тот же: эта связь обязана быть живой.
  const final = out.current!.liveGadget!
  for (const shown of seen.filter(item => item.key === final.key)) await expect(shown.connectToGadget()).resolves.toEqual({})
  // Новая связь (перечитывание) — новый ключ: экран пересоздаётся, а не звонит в закрытую.
  await act(async () => { out.current!.refresh(); await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(out.current?.liveGadget?.key).toMatch(/^2:/)
  await expect(out.current!.liveGadget!.connectToGadget()).resolves.toEqual({})
  await act(async () => root.unmount())
})

test('личная версия совместного приложения у автора — предпросмотр отдельным экземпляром; общий не трогается; переключатель на опубликованную', async () => {
  launch(`private:${HEAD}`)
  const h = harness({ deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(h.calls.previewDeploys).toEqual([`private:${HEAD}`])) })
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget?.key?.split(':')[1]).toBe('e'.repeat(64))) })
  expect(h.calls.deploys).toEqual([])
  expect(h.instances.shared?.version).toBe(PUBLISHED)
  expect(h.calls.downloads).toEqual([])
  expect(out.current?.previewMode).toBe(true)
  expect(out.current?.model).toMatchObject({ saved: 'Предпросмотр личной версии — данные не сохраняются для других', primary: { kind: 'submit', label: 'Опубликовать' }, secondary: { kind: 'published', label: 'Показать опубликованную' } })
  // Переключатель: экран — общий экземпляр с опубликованной версией; обратно — предпросмотр.
  await act(async () => { out.current!.setShowPublished(true) })
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget?.key?.split(':')[1]).toBe('c'.repeat(64))) })
  expect(out.current?.model?.secondary).toMatchObject({ kind: 'preview', label: 'Предпросмотр личной версии' })
  await act(async () => { out.current!.setShowPublished(false) })
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget?.key?.split(':')[1]).toBe('e'.repeat(64))) })
  await unmount()
})

test('без опубликованной версии предпросмотр без переключателя; читатель предпросмотр не открывает', async () => {
  launch(`private:${HEAD}`)
  const h = harness({ unpublished: true })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget).not.toBeNull()) })
  await act(async () => { await vi.waitFor(() => expect(out.current?.model?.saved).toMatch(/^Предпросмотр личной версии/)) })
  expect(out.current?.model?.secondary).toBeNull()
  expect(h.calls.deploys).toEqual([])
  await unmount()

  const reader = harness({ access: 'read', deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  await reader.gadget.setMnemosApp({ accountId: 7, scope: 'project', resource: 'node', description: '', collaborative: true, session: true, permissions: [], savedVersion: `private:${HEAD}` })
  const second = await mount(reader)
  await act(async () => { await vi.waitFor(() => expect(second.out.current?.access).toBe('read')) })
  await act(async () => { await vi.waitFor(() => expect(second.out.current?.liveGadget?.key?.split(':')[1]).toBe('c'.repeat(64))) })
  expect(reader.calls.previews).toBe(0)
  expect(second.out.current?.previewMode).toBe(false)
  await second.unmount()
})

test('без права правки: код не скачивается и не кладётся в рабочее место, виден только экран общего экземпляра', async () => {
  launch(PUBLISHED)
  const h = harness({ access: 'read', deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget).not.toBeNull()) })
  expect(h.calls.downloads).toEqual([])
  expect(h.calls.bindings.at(-1)?.savedCodeVersion).toBeUndefined()
  await unmount()
})

test('у гаджета-узла нет предпросмотра и кнопки «Сохранить»: беседа с правками не подменяет экран экземпляра', async () => {
  const h = harness({ deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  // Привязка из прежней версии оболочки с кодом в рабочем месте: код больше не показывается.
  await h.gadget.setMnemosApp(bound({ savedCodeVersion: 1 }))
  const { out, rerender, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.liveGadget).not.toBeNull()) })
  await rerender(3)
  expect(out.current?.preview).toBe(false)
  expect(out.current?.liveGadget).not.toBeNull()
  expect(out.current?.model?.primary?.kind).not.toBe('save')
  expect(h.calls.exports).toBe(0)
  await unmount()
})

test('«Вернуть» совместного приложения: Mnemos сам делает версию новой личной, общий экземпляр не меняется', async () => {
  const h = harness({ deployed: { version: PUBLISHED, sha256: 'c'.repeat(64), title: 'Общий список', collaborative: true } })
  await h.gadget.setMnemosApp(bound({ savedCodeVersion: 1 }))
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.access).toBe('owner')) })
  await act(async () => { await out.current!.restoreVersion({ id: 'event-0', recordedAt: '', author: '', personal: false }) })
  expect(h.calls.restores).toEqual([['project', 'node', 'event-0', HEAD, 'cloudflareos.app']])
  expect(h.calls.downloads).toEqual([])
  expect(h.calls.bindings.at(-1)).toMatchObject({ savedHead: NEXT, savedVersion: `private:${NEXT}` })
  expect(h.calls.bindings.at(-1)?.savedCodeVersion).toBeUndefined()
  expect(h.calls.deploys).toEqual([])
  expect(out.current?.notice).toMatch(/после публикации/)
  await unmount()
})

test('«Вернуть» своего приложения: новая версия сразу работает в своём экземпляре; отказ Mnemos — понятным текстом', async () => {
  const h = harness({ doc: SOLO })
  await h.gadget.setMnemosApp(bound({ collaborative: false, savedVersion: `private:${HEAD}` }))
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.access).toBe('owner')) })
  await act(async () => { await out.current!.restoreVersion({ id: PUBLISHED, recordedAt: '', author: '', personal: false }) })
  expect(h.calls.deploys).toEqual([[true, `private:${NEXT}`]])
  await unmount()

  const failing = harness({ doc: SOLO, restoreFails: true })
  await failing.gadget.setMnemosApp(bound({ collaborative: false, savedVersion: `private:${HEAD}` }))
  const second = await mount(failing)
  await act(async () => { await vi.waitFor(() => expect(second.out.current?.access).toBe('owner')) })
  await act(async () => { await second.out.current!.restoreVersion({ id: PUBLISHED, recordedAt: '', author: '', personal: false }) })
  expect(second.out.current?.error).toMatch(/^Версия не вернулась/)
  expect(failing.calls.deploys).toEqual([])
  await second.unmount()
})

test('гаджет беседы «Сохранить в проект»: код берётся из рабочего места беседы один раз, после привязки он закрыт', async () => {
  const h = harness({ doc: SOLO })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.app).not.toBeNull()) })
  expect(out.current?.showWorkspace).toBe(true)
  await act(async () => { await out.current!.saveToProject({ accountId: 7, scope: 'project', collaborative: false, description: '', permissions: [] }) })
  expect(h.calls.exports).toBe(1)
  expect(h.calls.creates).toEqual(['project'])
  expect(uploads).toEqual([gadgetAppText({ ...SOLO, manifest: { ...SOLO.manifest, title: 'Приложение', description: '' } })])
  expect(h.calls.bindings.at(-1)).toMatchObject({ resource: 'new-node', savedVersion: `private:${NEXT}` })
  expect(h.calls.bindings.at(-1)?.savedCodeVersion).toBeUndefined()
  expect(h.calls.deploys).toEqual([[true, `private:${NEXT}`]])
  expect(out.current?.showWorkspace).toBe(false)
  await expect(h.gadget.exportAppModules()).rejects.toThrow()
  await unmount()
})
