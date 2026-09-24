// @vitest-environment jsdom
// Живой путь открытия общего документа: «Поделились с вами» → рабочее место → «Версии» с продолжением открытия →
// переподключение (перезагрузка) → «Открыть документ» → перезагрузка. Редактор ведёт себя как настоящий: снимок
// отдаёт по одному запросу за раз и отказывает, пока перерисовывается после восстановления версии.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import type { NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import DocumentStatus from './DocumentStatus'
import { queueNativeSnapshots } from './nativeSnapshotSource'

const { api, download, reload } = vi.hoisted(() => ({
  api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<unknown>>() },
  download: vi.fn<(...args: any[]) => Promise<unknown>>(),
  reload: { current: () => {} },
}))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperNativeDocument: download, downloadGatekeeperNativeReview: vi.fn<() => Promise<null>>() }))
vi.mock('./gatekeeperAppUpload', () => ({ uploadGatekeeperNativeDocument: async () => 'upload-1' }))
vi.mock('./pageReload', () => ({ reloadPage: () => reload.current() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks() })

const ownerHead = 'd'.repeat(64)
const mime = 'cloudflareos.document' as const
const ownerVersion: NativeDocumentSnapshot = { format: mime, formatVersion: 1, document: { title: 'Дорожная карта', blocks: [{ id: 'b1', html: '<h2>Дорожная карта</h2>' }, { id: 'b2', html: '<p>Перевод команды на целевую систему.</p>' }] } }
class Empty extends RpcTarget {}

function installation(previous: object | null) {
  const saves: string[][] = []
  const server = { binding: previous as Record<string, unknown> | null }
  // Редактор: состояние гаджета на сервере переживает перезагрузку страницы.
  const editor = { revision: 3, restoreRevision: 0, title: 'Новый документ', blocks: [] as { id: string; html: string; version: number }[], busy: false, redrawUntil: 0 }
  let prepared = 0
  // Как в GadgetUI: запросы к редактору идут очередью, а сам редактор второй одновременный запрос отвергает.
  const snapshotSource = { current: queueNativeSnapshots(async (format: string, signal: AbortSignal): Promise<NativeDocumentSnapshot> => {
    if (editor.busy || Date.now() < editor.redrawUntil) throw new Error('Редактор не смог сохранить текущую версию.')
    editor.busy = true
    try {
      await new Promise((resolve, reject) => { const t = setTimeout(resolve, 5); signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Редактор не отдал документ.')) }, { once: true }) })
      return { format: format as typeof mime, formatVersion: 1, document: { revision: editor.revision, restoreRevision: editor.restoreRevision, title: editor.title, blocks: editor.blocks, lastModified: Date.now() } }
    } finally { editor.busy = false }
  }) }
  class Editor extends RpcTarget {
    async getDocument() { return { revision: editor.revision } }
    async restoreDocumentSnapshot(snapshot: NativeDocumentSnapshot, expected: number) {
      if (expected !== editor.revision) throw new Error('Document changed; reload before restoring.')
      const document = snapshot.document as { title: string; blocks: { id: string; html: string }[] }
      editor.revision += 1; editor.restoreRevision = editor.revision
      editor.title = document.title; editor.blocks = document.blocks.map(b => ({ ...b, version: editor.revision }))
      // Окно редактора перерисовывается: снимок в это время не отдаётся.
      editor.redrawUntil = Date.now() + 150
      return { revision: editor.revision, restoreRevision: editor.restoreRevision, title: editor.title, blocks: editor.blocks }
    }
  }
  class Side extends RpcTarget { async issue() { return { url: 'owner', method: 'GET', size_bytes: 1, sha256_hex: 'c'.repeat(64), content_type: 'application/vnd.cloudflareos.document+json' } } async validate() {} }
  download.mockImplementation(async () => structuredClone(ownerVersion))
  class Writer extends RpcTarget {
    async head() { return ownerHead }
    async access() { return 'write' as const }
    async issue() { return { upload_id: 'upload-1', url: 'https://objects.example/u', method: 'PUT', headers: {}, expires_at: '' } }
    async save(base: string, upload: string) { saves.push([base, upload]); return 'f'.repeat(64) }
  }
  class Writes extends RpcTarget {
    async publicationState() { return { personal_head: 'a'.repeat(64), shared_head: 'b'.repeat(64), personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async sharedDocuments() { return { documents: [{ scope: 'project', resource: 'doc', name: 'Дорожная карта' }] } }
    async reviewerIdentity() { return 'admin' }
    async scopes() { return { scopes: [{ id: 'project', name: 'Перевод' }] } }
  }
  class Downloads extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Перевод' }] } }
    async documents() { return { documents: [{ id: 'doc', name: 'Дорожная карта' }], nextCursor: '', truncated: false } }
    async publications() { return { resourceUrl: 'https://memory.example/doc', nextCursor: '', publications: [{ id: 'private:' + ownerHead, recordedAt: new Date(Date.now() - 60_000).toISOString(), actor: '', author: 'Николай Деревцов', format: mime }] } }
    async select() { return new RpcStub(new Side()) }
  }
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Writes()) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }))
  api.subscribeConnectedAccounts.mockImplementation(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return new RpcStub(new Empty()) })

  /** Вкладка страницы: своя связь с гаджетом, которую перезапуск чтения закрывает. */
  function gadgetForPage() {
    let broken = false
    class Download extends RpcTarget { async issue() { return { url: 'owner' } } async validate() {} }
    class Gadget extends RpcTarget {
      async getId() { if (broken) throw new Error('lost connection to workspace DO'); return 'native-doc' }
      async getMnemosDocument() { return { binding: server.binding, creation: null, project: null } }
      async setMnemosDocument(next: Record<string, unknown> | null) { await new Promise(resolve => setTimeout(resolve, 5)); server.binding = next }
      async ensureNativeDocumentTitle() { return 'Дорожная карта' }
      async getNativeEditorUpdate() { return null }
      async prepareNativeDocumentRead() { prepared++; if (prepared === 1) { setTimeout(() => { broken = true }, 20); return { sourceId: 9, restartRequired: true } } return { sourceId: 9, restartRequired: false } }
      async readNativeDocument() { return { storageOrigin: 'https://objects.example', download: new RpcStub(new Download()) } }
      async connectToGadget() { return new RpcStub(new Editor()) }
    }
    return new RpcStub(new Gadget())
  }
  return { saves, server, editor, snapshotSource, gadgetForPage }
}

/** Страница рабочего места; перезагрузка — новая страница с тем же sessionStorage и тем же сервером. */
async function openWorkspace(world: ReturnType<typeof installation>) {
  let root: Root | null = null, container: HTMLDivElement | null = null, gadget: ReturnType<typeof world.gadgetForPage> | null = null
  let reloads = 0
  const mount = async () => {
    if (root) { const old = root; await act(async () => old.unmount()); container!.remove(); gadget![Symbol.dispose]() }
    container = document.createElement('div'); document.body.append(container)
    root = createRoot(container); gadget = world.gadgetForPage()
    const page = gadget
    await act(async () => root!.render(<DocumentStatus gadget={page as unknown as RpcStub<GadgetClient>} format={mime} snapshotSource={world.snapshotSource} changesPollMs={40} autosaveMs={20} />))
  }
  reload.current = () => { reloads++; setTimeout(() => { void mount() }, 0) }
  await mount()
  const text = () => document.querySelector('[data-document-status]')?.textContent ?? ''
  const step = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  const until = async (check: () => boolean, what: string) => { for (let i = 0; i < 1500 && !check(); i++) await step(); expect(check(), `${what} | шапка: ${text()} | панель: ${document.querySelector('[data-version-panel]')?.textContent ?? 'нет'}`).toBe(true) }
  const close = async () => { if (root) { const old = root; await act(async () => old.unmount()); container!.remove(); gadget![Symbol.dispose]() } }
  return { text, until, step, reloads: () => reloads, close }
}

it.each([
  ['новое рабочее место', null],
  ['рабочее место, где документ уже открывали', { accountId: 1, scope: 'project', resource: 'doc', savedHead: 'e'.repeat(64), savedRevision: 2 }],
] as const)('общий документ из «Поделились с вами» (%s): после «Открыть документ» и перезагрузки — «сохранено», новой версии нет; правка уходит в документ владельца', async (_name, previous) => {
  const world = installation(previous)
  if (previous) {
    // В прошлый раз в этом рабочем месте открыли ту же версию и ничего не правили.
    world.editor.revision = 2; world.editor.title = 'Дорожная карта'
    world.editor.blocks = (ownerVersion.document as { blocks: { id: string; html: string }[] }).blocks.map(b => ({ ...b, version: 2 }))
  }
  // Так оставляет выбор launchSharedDocument: какой документ и какую версию открыть в этом рабочем месте.
  sessionStorage.setItem('mnemos-document-launch:/', JSON.stringify({ accountId: 1, scope: 'project', resource: 'doc', format: mime, publication: 'private:' + ownerHead, at: Date.now() }))
  const page = await openWorkspace(world)
  try {
    // Первое открытие просит переподключиться для проверки доступа: страница перезагружается.
    await page.until(() => page.reloads() >= 1, 'переподключение после первого открытия')
    // После перезагрузки — «Продолжить открытие»; человек нажимает «Открыть документ», если оно не пошло само.
    await page.until(() => page.reloads() >= 2 || !![...document.querySelectorAll('button')].find(b => b.textContent === 'Открыть документ' && !b.disabled), 'кнопка «Открыть документ»')
    if (page.reloads() < 2) await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Открыть документ')!.click() })
    await page.until(() => page.reloads() >= 2, 'перезагрузка после открытия: ' + (document.querySelector('[data-version-panel]')?.textContent ?? 'нет панели'))
    expect(world.editor.title).toBe('Дорожная карта')
    // Привязка на сервере рабочего места знает ревизию редактора с открытой версией — до перезагрузки.
    expect(world.server.binding).toMatchObject({ scope: 'project', resource: 'doc', savedHead: ownerHead, savedRevision: world.editor.revision })
    await page.until(() => page.text().includes('сохранено') && page.text().includes('Общий документ'), `«сохранено», а в шапке: ${page.text()}`)
    for (let i = 0; i < 20; i++) await page.step()
    expect(page.text()).not.toMatch(/сохраняю|сверяю|не сохранено/)
    expect(world.saves).toEqual([])
    // Правка человека уходит сохранением от версии владельца, строка доходит до «сохранено».
    world.editor.revision += 1; world.editor.blocks = [...world.editor.blocks, { id: 'b3', html: '<p>Срок — октябрь.</p>', version: world.editor.revision }]
    await page.until(() => world.saves.length === 1, 'сохранение правки')
    expect(world.saves[0]).toEqual([ownerHead, 'upload-1'])
    await page.until(() => page.text().includes('сохранено') && !page.text().includes('не сохранено'), `«сохранено» после правки, а в шапке: ${page.text()}`)
  } finally { await page.close() }
}, 30_000)

it('открытая без правок копия с неизвестной ревизией не пишет пустую версию: сверка с версией владельца', async () => {
  const world = installation({ accountId: 1, scope: 'project', resource: 'doc', savedHead: ownerHead })
  world.editor.title = 'Дорожная карта'; world.editor.blocks = (ownerVersion.document as { blocks: { id: string; html: string }[] }).blocks.map(b => ({ ...b, html: b.html.replace('</h2>', '</h2>\n'), version: 4 }))
  const page = await openWorkspace(world)
  try {
    await page.until(() => page.text().includes('сохранено'), `«сохранено», а в шапке: ${page.text()}`)
    for (let i = 0; i < 10; i++) await page.step()
    expect(world.saves).toEqual([])
    expect(world.server.binding).toMatchObject({ savedHead: ownerHead, savedRevision: world.editor.revision })
  } finally { await page.close() }
}, 30_000)
