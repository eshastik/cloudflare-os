// @vitest-environment jsdom
// Копии приложения без совместной работы (ADR 0028, этап 3): получатель вместо оригинала создаёт свою
// копию, обновление автора ставится только по его согласию, «Поделиться» раздаёт копии правом чтения,
// совместное приложение — как раньше.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, test, vi } from 'vitest'
import { gadgetAppText, type GadgetAppDocument, type MnemosAppBinding, type MnemosAppCopyState, type MnemosAppOffer, type MnemosAppState } from '@gadgets/workshop-shared/gadget-app'

const { frames } = vi.hoisted(() => ({ frames: { writes: null as unknown, downloads: null as unknown } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: null, currentUser: { name: 'Анна' } }) }))
vi.mock('./components/MnemosAvatar', () => ({ default: () => null }))
vi.mock('./accountCapabilities', () => ({
  listAccounts: async () => [{ id: 7, vendorId: 'mnemos' }],
  storesDocuments: () => true,
  openNativeWritesFrame: async () => ({ iframeHtml: '', ui: {}, nativeWrites: { storageOrigin: 'https://objects.example', selector: frames.writes }, nativeDownloads: { storageOrigin: 'https://objects.example', selector: frames.downloads } }),
  openNativeWritesContext: async () => ({accountId: 1, frame: { iframeHtml: '', ui: {}, nativeWrites: { storageOrigin: 'https://objects.example', selector: frames.writes }, nativeDownloads: { storageOrigin: 'https://objects.example', selector: frames.downloads } }}),
}))
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: () => {} }))
const texts = new Map<string, string>()
vi.mock('./gatekeeperAppUpload', () => ({ uploadGatekeeperAppText: async () => 'upload-1' }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import DocumentSharePanel from './DocumentSharePanel'
import { APP_COPY_OFFER, MakeOwnDialog, deriveAppStatus, useMnemosApp, type MnemosAppHandle } from './MnemosAppStatus'

const ORIGINAL_HEAD = 'a'.repeat(64), COPY_HEAD = 'c'.repeat(64), UPDATED_HEAD = 'e'.repeat(64)
const SOLO: GadgetAppDocument = { manifest: { title: 'Мои задачи', description: '', collaborative: false, session: true, formatVersion: 1, permissions: [] }, modules: { 'client.js': 'ui()', 'server.js': 'export class Gadget { session(c) { return c } }' } }
const RELEASE = { version: 'event-1', title: 'Мои задачи', publishedAt: '2026-09-29T10:00:00Z', authorName: 'Анна' }

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/'); texts.clear() })

/** Борис: оригинал Анны ('node') ему открыт на чтение, своя копия — 'copy-node' в проекте 'mine'. */
function harness(options: { offer?: MnemosAppOffer; copy?: MnemosAppCopyState | null; legacy?: boolean; ownError?: string } = {}) {
  let state: MnemosAppState = { binding: null, codeVersion: 1, title: 'Приложение', notExportable: null }
  const calls = { downloads: [] as string[], deploys: [] as [string, string][], makeCopy: [] as [string, boolean][], applyUpdate: [] as string[], dismiss: [] as string[], own: 0, opens: [] as [string, boolean][] }
  let copyState = options.copy ?? null
  const deployed: Record<string, string | null> = options.copy ? { 'copy-node:true': `private:${COPY_HEAD}` } : options.legacy ? { 'node:true': `private:${ORIGINAL_HEAD}` } : {}
  const gadget = {
    getId: async () => 5,
    getMnemosApp: async () => state,
    setMnemosApp: async (binding: MnemosAppBinding | null) => { state = { ...state, binding } },
    exportAppModules: async () => ({ codeVersion: state.codeVersion, title: state.title, modules: SOLO.modules }),
  }
  const connect = (resource: string, personal: boolean) => {
    const key = `${resource}:${personal}`
    const connection = {
      describe: async () => ({ access: resource === 'node' ? 'read' : 'edit', caller: { principal: 'boris', name: 'Борис' }, deployed: deployed[key] ? { version: deployed[key], sha256: 'd'.repeat(64), title: 'Мои задачи', collaborative: false } : null }),
      manifest: async () => SOLO.manifest,
      deploy: async (version: string) => { calls.deploys.push([resource, version]); deployed[key] = version; return connection.describe() },
      getUiBundle: async () => ({ jsCode: 'ui()' }), connectToGadget: async () => ({}),
      offer: async () => resource === 'node' ? (options.offer ?? { release: RELEASE, copy: null }) : { release: null, copy: null },
      copyState: async () => resource === 'copy-node' ? copyState : null,
      makeCopy: async (scope: string, again: boolean) => { calls.makeCopy.push([scope, again]); texts.set(`private:${COPY_HEAD}`, gadgetAppText(SOLO)); return { scope: 'mine', resource: 'copy-node' } },
      applyUpdate: async (version: string) => { calls.applyUpdate.push(version); copyState = copyState && { ...copyState, update: null }; texts.set(`private:${UPDATED_HEAD}`, gadgetAppText(SOLO)); return { version: `private:${UPDATED_HEAD}` } },
      dismissUpdate: async (version: string) => { calls.dismiss.push(version) },
      makeOwn: async () => { calls.own++; if (options.ownError) throw new Error(options.ownError); copyState = null },
      [Symbol.dispose]: () => {},
    }
    return connection
  }
  const api = { openMnemosApp: vi.fn(async (_a: number, _s: string, resource: string, personal: boolean) => { calls.opens.push([resource, personal]); return connect(resource, personal) }), subscribeConnectedAccounts: vi.fn(), getGatekeeperApp: vi.fn() }
  const writer = { head: async () => COPY_HEAD, access: async () => 'owner', [Symbol.dispose]: () => {} }
  frames.writes = {
    appAccess: async (_scope: string, resource: string) => ({ access: resource === 'node' ? 'read' : 'edit', principal: 'boris', tenant: 'org', name: 'Борис', project: 'project', node: resource }),
    select: async (_scope: string, resource: string) => { if (resource === 'node') throw new Error('чужой'); return writer },
    scopes: async () => ({ scopes: [{ id: 'mine', name: 'Мой проект' }] }),
  }
  frames.downloads = {
    // Тело версии браузер не читает никогда (ADR 0028, п. 4): любой выбор версии здесь — ошибка теста.
    select: async (_scope: string, _resource: string, version: string) => { calls.downloads.push(version); throw new Error('код приложения закрыт') },
    publications: async (_scope: string, resource: string) => ({ publications: resource === 'copy-node' ? [{ id: `private:${COPY_HEAD}`, format: 'cloudflareos.app', recordedAt: '', actor: '' }] : [], nextCursor: '' }),
  }
  texts.set(`private:${ORIGINAL_HEAD}`, gadgetAppText(SOLO))
  return { gadget, api, calls, state: () => state }
}

async function mount(h: ReturnType<typeof harness>) {
  const out: { current: MnemosAppHandle | null } = { current: null }
  function Probe() { out.current = useMnemosApp({ api: h.api as never, gadget: h.gadget as never, pollMs: 0 }); return null }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  return { out, unmount: () => act(async () => root.unmount()) }
}
const launch = () => {
  history.replaceState(null, '', '/workspace/ws-app')
  sessionStorage.setItem('mnemos-app-launch:/workspace/ws-app', JSON.stringify({ accountId: 7, scope: 'project', resource: 'node', publication: `private:${ORIGINAL_HEAD}`, gadgetId: 5, at: Date.now() }))
}

test('получатель открывает чужое приложение без общих данных: код не скачивается, ничего не запускается, предлагается своя копия', async () => {
  launch()
  // Экземпляр, запущенный получателем до этапа 3, не показывается: только опубликованное и только в копии.
  const h = harness({ legacy: true })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.offerMode).toBe(true)) })
  await act(async () => { await vi.waitFor(() => expect(out.current?.offer?.release?.version).toBe('event-1')) })
  expect(h.calls.downloads).toEqual([])
  expect(h.calls.deploys).toEqual([])
  expect(out.current?.liveGadget).toBeNull()
  expect(out.current?.liveError).toBe(APP_COPY_OFFER)
  expect(out.current?.model).toMatchObject({ primary: { kind: 'copy', label: 'Создать копию' } })

  await act(async () => { await out.current!.makeCopy('mine', false) })
  expect(h.calls.makeCopy).toEqual([['mine', false]])
  // Копия — свой узел: код в рабочее место не встаёт, работает её личная версия в своём экземпляре.
  expect(h.state().binding).toMatchObject({ scope: 'mine', resource: 'copy-node', collaborative: false, savedVersion: `private:${COPY_HEAD}` })
  expect(h.state().binding?.savedCodeVersion).toBeUndefined()
  expect(h.calls.downloads).toEqual([])
  expect(h.calls.deploys).toEqual([['copy-node', `private:${COPY_HEAD}`]])
  await act(async () => { await vi.waitFor(() => expect(out.current?.access).toBe('owner')) })
  expect(out.current?.offerMode).toBe(false)
  await unmount()
})

test('копия уже есть: открытие оригинала сразу открывает её, новой не создаёт', async () => {
  launch()
  const h = harness({ offer: { release: RELEASE, copy: { scope: 'mine', resource: 'copy-node' } } })
  texts.set(`private:${COPY_HEAD}`, gadgetAppText(SOLO))
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(h.state().binding?.resource).toBe('copy-node')) })
  expect(h.calls.makeCopy).toEqual([])
  await act(async () => { await vi.waitFor(() => expect(out.current?.notice).toMatch(/ваша копия/)) })
  await unmount()
})

test('обновление автора: предлагается в шапке, «Не сейчас» и «Обновить» — только по нажатию; обновление ставит новую версию в копию', async () => {
  const update = { version: 'event-2', title: 'Мои задачи', publishedAt: '2026-09-30T08:00:00Z', authorName: 'Анна' }
  const h = harness({ copy: { author: 'Анна', title: 'Мои задачи', version: 'event-1', copiedAt: '2026-09-29T10:00:00Z', updatedAt: '2026-09-29T10:00:00Z', origin: 'open', update, dismissed: false } })
  texts.set(`private:${COPY_HEAD}`, gadgetAppText(SOLO))
  await h.gadget.setMnemosApp({ accountId: 7, scope: 'mine', resource: 'copy-node', description: '', collaborative: false, session: true, permissions: [], savedCodeVersion: 1, savedHead: COPY_HEAD, savedVersion: `private:${COPY_HEAD}` })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.model?.primary?.kind).toBe('update')) })
  expect(out.current?.model).toMatchObject({ version: 'Копия приложения Анна', secondary: { kind: 'dismiss', label: 'Не сейчас' } })
  expect(out.current?.model?.saved).toMatch(/^доступно обновление от Анна: версия от 30 сентября/)
  expect(h.calls.applyUpdate).toEqual([])

  await act(async () => { await out.current!.dismissUpdate() })
  expect(h.calls.dismiss).toEqual(['event-2'])
  expect(out.current?.model?.primary?.kind).not.toBe('update')

  await act(async () => { await out.current!.applyUpdate() })
  expect(h.calls.applyUpdate).toEqual(['event-2'])
  expect(h.state().binding).toMatchObject({ resource: 'copy-node', savedVersion: `private:${UPDATED_HEAD}` })
  expect(h.state().binding?.savedCodeVersion).toBeUndefined()
  expect(h.calls.downloads).toEqual([])
  await unmount()
})

test('шапка копии: автор закрыл доступ — копия своя, обновлений не будет; обновление — только владельцу копии', () => {
  const closed = deriveAppStatus({ access: 'owner', collaborative: false, savedVersion: `private:${COPY_HEAD}`, copy: { author: 'Анна', origin: 'closed', update: null, dismissed: false } })
  expect(closed).toMatchObject({ version: 'Копия приложения Анна', audience: 'автор закрыл доступ к оригиналу, обновлений не будет' })
  const update = { version: 'event-2', title: 'x', publishedAt: '2026-09-30T08:00:00Z', authorName: 'Анна' }
  expect(deriveAppStatus({ access: 'owner', collaborative: false, savedVersion: `private:${COPY_HEAD}`, copy: { author: 'Анна', origin: 'open', update, dismissed: false } }).primary?.kind).toBe('update')
  // Предложение обновиться — только владельцу копии.
  expect(deriveAppStatus({ access: 'read', collaborative: false, savedVersion: 'x', copy: { author: 'Анна', origin: 'open', update, dismissed: false } }).primary).toBeNull()
  expect(deriveAppStatus({ access: 'read', collaborative: false, offer: { ready: false } })).toMatchObject({ saved: 'автор ещё не опубликовал приложение', primary: null })
})

function shareSelector() {
  const calls: [string, string][] = []
  const selector = {
    select: async () => ({ head: async () => 'h'.repeat(64), access: async () => 'owner', [Symbol.dispose]: () => {} }),
    participants: async () => ({ head: '', nextCursor: '', participants: [
      { id: 'boris', name: 'Борис', mode: '', canRead: true, canWrite: true, units: [] },
      { id: 'vera', name: 'Вера', mode: 'read', canRead: true, canWrite: true, units: [] },
    ] }),
    projectLevel: async () => ({ name: 'Проект Анны', level: 'private', canEdit: true, pending: null }),
    departments: async () => ({ units: [] }), reviewerIdentity: async () => 'anna', sharedDocuments: async () => ({ documents: [] }),
    setParticipant: async (_s: string, _r: string, _h: string, who: string, _e: string, mode: string) => { calls.push([who, mode]) },
  }
  return { selector, calls }
}
async function renderShare(copies: Parameters<typeof DocumentSharePanel>[0]['copies']) {
  const { selector, calls } = shareSelector()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<DocumentSharePanel selector={selector as never} binding={{ accountId: 7, scope: 'project', resource: 'node' } as never} format="cloudflareos.app" documentName="Мои задачи" onClose={() => {}} copies={copies} />))
  await act(async () => { await vi.waitFor(() => expect(container.querySelector('[data-candidate]')).not.toBeNull()) })
  const pick = async () => { await act(async () => (container.querySelector('[data-candidate]') as HTMLButtonElement).click()) }
  const invite = async () => { await act(async () => (container.querySelector('[data-share-invite]') as HTMLButtonElement).click()) }
  return { container, calls, pick, invite, unmount: async () => { await act(async () => root.unmount()); container.remove() } }
}

test('«Поделиться» приложением без общих данных: каждый получит свою копию, право — только чтение, выбора права нет', async () => {
  const view = await renderShare({ release: RELEASE })
  expect(view.container.querySelector('[data-share-copies]')?.textContent).toMatch(/Каждый получит свою копию/)
  expect(view.container.querySelector('[data-share-copies]')?.textContent).toMatch(/опубликованную 29 сентября/)
  expect(view.container.textContent).toMatch(/своя копия/)
  await view.pick()
  expect(view.container.querySelector('[role="radiogroup"]')).toBeNull()
  expect(view.container.querySelector('[data-share-invite]')?.textContent).toBe('Поделиться (1)')
  await view.invite()
  expect(view.calls).toEqual([['boris', 'read']])
  expect(view.container.textContent).toMatch(/получит свою копию с пустыми данными/)
  await view.unmount()
  const unpublished = await renderShare({ release: null })
  expect(unpublished.container.querySelector('[data-share-copies]')?.textContent).toMatch(/Опубликованной версии пока нет/)
  await unpublished.unmount()
})

test('совместное приложение «Поделиться» — как раньше: выбор права, приглашение с правкой', async () => {
  const view = await renderShare(undefined)
  expect(view.container.querySelector('[data-share-copies]')).toBeNull()
  await view.pick()
  expect(view.container.querySelector('[role="radiogroup"]')).not.toBeNull()
  expect(view.container.querySelector('[data-share-invite]')?.textContent).toBe('Пригласить 1')
  await view.invite()
  expect(view.calls).toEqual([['boris', 'write']])
  await view.unmount()
})

test('«Сделать своей»: кнопка в шапке своей копии; после успеха копия отвязана и обновлений автора нет', async () => {
  const update = { version: 'event-2', title: 'Мои задачи', publishedAt: '2026-09-30T08:00:00Z', authorName: 'Анна' }
  const h = harness({ copy: { author: 'Анна', title: 'Мои задачи', version: 'event-1', copiedAt: '2026-09-29T10:00:00Z', updatedAt: '2026-09-29T10:00:00Z', origin: 'open', update: null, dismissed: false } })
  await h.gadget.setMnemosApp({ accountId: 7, scope: 'mine', resource: 'copy-node', description: '', collaborative: false, session: true, permissions: [], savedHead: COPY_HEAD, savedVersion: `private:${COPY_HEAD}` })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.model?.secondary?.kind).toBe('own')) })
  expect(out.current?.model?.secondary?.label).toBe('Сделать своей')
  let refused: string | null = 'не вызвано'
  await act(async () => { refused = await out.current!.makeOwn() })
  expect(refused).toBeNull()
  expect(h.calls.own).toBe(1)
  await act(async () => { await vi.waitFor(() => expect(out.current?.copy).toBeNull()) })
  expect(out.current?.model?.secondary).toBeNull()
  expect(out.current?.model?.primary?.kind).not.toBe('update')
  expect(out.current?.notice).toMatch(/агента кода/)
  // У чужого оригинала, закрытого автором, и у копии с непрочитанным доступом кнопки нет.
  expect(deriveAppStatus({ access: 'owner', collaborative: false, savedVersion: `private:${COPY_HEAD}`, copy: { author: 'Анна', origin: 'closed', update: null, dismissed: false } }).secondary).toBeNull()
  expect(deriveAppStatus({ access: 'read', collaborative: false, savedVersion: 'x', copy: { author: 'Анна', origin: 'open', update: null, dismissed: false } }).secondary).toBeNull()
  // Пока есть обновление, в шапке — «Не сейчас»; «Сделать своей» остаётся в «Версиях».
  expect(deriveAppStatus({ access: 'owner', collaborative: false, savedVersion: `private:${COPY_HEAD}`, copy: { author: 'Анна', origin: 'open', update, dismissed: false } }).secondary?.kind).toBe('dismiss')
  await unmount()
})

test('«Сделать своей»: исходники версии не сохранились — отказ понятным текстом, копия остаётся копией', async () => {
  const NO_SOURCES = 'Исходники этой версии гаджета не сохранились: сделать копию своей нельзя. Попросите автора пересохранить гаджет через агента кода.'
  const h = harness({ ownError: NO_SOURCES, copy: { author: 'Анна', title: 'Мои задачи', version: 'event-1', copiedAt: '2026-09-29T10:00:00Z', updatedAt: '2026-09-29T10:00:00Z', origin: 'open', update: null, dismissed: false } })
  await h.gadget.setMnemosApp({ accountId: 7, scope: 'mine', resource: 'copy-node', description: '', collaborative: false, session: true, permissions: [], savedHead: COPY_HEAD, savedVersion: `private:${COPY_HEAD}` })
  const { out, unmount } = await mount(h)
  await act(async () => { await vi.waitFor(() => expect(out.current?.model?.secondary?.kind).toBe('own')) })
  let refused: string | null = null
  await act(async () => { refused = await out.current!.makeOwn() })
  expect(refused).toBe(NO_SOURCES)
  expect(out.current?.copy).not.toBeNull()
  expect(out.current?.model?.secondary?.kind).toBe('own')
  await unmount()
})

test('окно подтверждения «Сделать своей»: текст решения владельца, отказ — в окне, успех закрывает окно', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const makeOwn = vi.fn(async () => 'Хранилище исходников гаджетов недоступно. Повторите позже.')
  const onOpenChange = vi.fn()
  await act(async () => root.render(<MakeOwnDialog handle={{ makeOwn, busy: false, copy: null }} open onOpenChange={onOpenChange} />))
  expect(document.body.textContent).toContain('Вы сможете менять гаджет через агента кода. Обновления от автора больше не будут приходить.')
  const confirm = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Сделать своей')!
  await act(async () => { confirm.click() })
  await act(async () => { await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toMatch(/недоступно/)) })
  expect(onOpenChange).not.toHaveBeenCalledWith(false)
  makeOwn.mockResolvedValueOnce(null as never)
  await act(async () => { confirm.click() })
  await act(async () => { await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false)) })
  await act(async () => root.unmount()); container.remove()
})

test('сбой чтения публикации не объявляет приложение неопубликованным и даёт повторить', async () => {
  const retry = vi.fn()
  const view = await renderShare({ release: null, error: 'Сведения о публикации не прочитаны.', retry })
  try {
    expect(view.container.textContent).toContain('Сведения о публикации не прочитаны.')
    expect(view.container.textContent).not.toContain('Опубликованной версии пока нет')
    const button = [...view.container.querySelectorAll('button')].find(b => b.textContent === 'Повторить')!
    await act(async () => button.click())
    expect(retry).toHaveBeenCalledOnce()
  } finally { await view.unmount() }
})
