// @vitest-environment jsdom
// Гаджет из беседы открывается в панели этой же беседы: без перехода в раздел «Проекты» и без второго гаджета.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MnemosAppBinding, MnemosAppState } from '@gadgets/workshop-shared/gadget-app'

const { store } = vi.hoisted(() => ({ store: { format: 'cloudflareos.app', publicationsRead: 0 } }))
vi.mock('./accountCapabilities', () => ({
  openNativeDownloadsFrame: async (_api: unknown, accountId: number) => {
    if (accountId !== 3) throw new Error('Нет подключения')
    return { nativeDownloads: { selector: { publications: async () => { store.publicationsRead++; return { publications: [{ id: 'private:head-1', format: store.format }], nextCursor: '' } } } } }
  },
}))
vi.mock('./disposeGatekeeperFrame', () => ({ disposeGatekeeperFrame: () => {} }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { openAppInWorkspace, WorkpieceArrivals, type AppWorkspace } from './mnemosAppInChat'
import { readMnemosAppLaunch } from './mnemosAppLaunch'
import { mnemosLinkOpener, type OpenAppInChat } from './components/chat/useMnemosLink'
import { GadgetWorkCard, type SavedGadget } from './components/chat/GadgetWorkCard'

type Gadget = { id: number; title: string; filesRoot?: string; binding: MnemosAppBinding | null }

function workspace(initial: Gadget[] = []) {
  const gadgets = [...initial]
  const created: string[] = []
  const handle = (id: number) => ({
    getId: async () => { if (!gadgets.some(g => g.id === id)) throw new Error(`No such gadget: ${id}`); return id },
    getMnemosApp: async (): Promise<MnemosAppState> => {
      const g = gadgets.find(item => item.id === id)
      if (!g) throw new Error(`No such gadget: ${id}`)
      return { binding: g.binding, codeVersion: 1, title: g.title, notExportable: null }
    },
    [Symbol.dispose]: () => {},
  })
  const overseer: AppWorkspace['overseer'] = {
    getGadget: handle,
    createGadget: async (title: string) => {
      created.push(title)
      const id = Math.max(0, ...gadgets.map(g => g.id)) + 1
      gadgets.push({ id, title, binding: null })
      return handle(id)
    },
  }
  // Список рабочего места приходит подпиской и может отставать: listed — то, что уже видит страница.
  let listed = gadgets.map(g => g.id)
  const view = (): AppWorkspace => ({ id: 'ws-chat', overseer, gadgets: gadgets.filter(g => listed.includes(g.id)).map(g => ({ id: g.id, ...(g.filesRoot ? { filesRoot: g.filesRoot } : {}) })) })
  return { gadgets, created, view, sync: () => { listed = gadgets.map(g => g.id) } }
}

const api = {} as never
const target = { accountId: 3, scope: 'hr', resource: 'node-7', title: 'Учёт отпусков' }
const bindingOf = (resource: string): MnemosAppBinding => ({ accountId: 3, scope: 'hr', resource, description: '', collaborative: true, session: true, permissions: [], savedVersion: 'event-1' })

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/workspace/ws-chat'); store.format = 'cloudflareos.app'; store.publicationsRead = 0 })

describe('приложение Mnemos в рабочем месте беседы', () => {
  it('гаджета нет — создаётся один, заявка открытия пишется для этой страницы; повтор не создаёт второй', async () => {
    const ws = workspace([{ id: 1, title: 'Беседа', filesRoot: '1', binding: null }])
    expect(await openAppInWorkspace(api, ws.view(), target)).toBe(2)
    expect(ws.created).toEqual(['Учёт отпусков'])
    // Привязку ставит шапка после проверки прав; здесь только заявка на последнюю версию узла.
    expect(ws.gadgets.find(g => g.id === 2)?.binding).toBeNull()
    expect(readMnemosAppLaunch()).toMatchObject({ accountId: 3, scope: 'hr', resource: 'node-7', publication: 'private:head-1', gadgetId: 2 })
    // Повтор до того, как список рабочего места обновился, и после.
    expect(await openAppInWorkspace(api, ws.view(), target)).toBe(2)
    ws.sync()
    expect(await openAppInWorkspace(api, ws.view(), target)).toBe(2)
    expect(ws.created).toHaveLength(1)
  })

  it('гаджет, привязанный к узлу, уже есть — открывается он, версии узла не читаются', async () => {
    const ws = workspace([{ id: 1, title: 'Беседа', filesRoot: '1', binding: null }, { id: 4, title: 'Другой', binding: bindingOf('node-9') }, { id: 5, title: 'Отпуска', binding: bindingOf('node-7') }])
    expect(await openAppInWorkspace(api, ws.view(), target)).toBe(5)
    expect(ws.created).toEqual([])
    expect(store.publicationsRead).toBe(0)
  })

  it('двойной щелчок во время открытия — один гаджет', async () => {
    const ws = workspace()
    const [a, b] = await Promise.all([openAppInWorkspace(api, ws.view(), target), openAppInWorkspace(api, ws.view(), target)])
    expect([a, b]).toEqual([1, 1])
    expect(ws.created).toHaveLength(1)
  })

  it('узел — документ, а не приложение: гаджет не создаётся', async () => {
    store.format = 'cloudflareos.document'
    const ws = workspace()
    expect(await openAppInWorkspace(api, ws.view(), target)).toBeNull()
    expect(ws.created).toEqual([])
    expect(readMnemosAppLaunch()).toBeNull()
  })

  it('удалённый гаджет, запомненный браузером, не мешает: создаётся новый', async () => {
    const ws = workspace()
    expect(await openAppInWorkspace(api, ws.view(), target)).toBe(1)
    ws.gadgets.splice(0, 1); ws.sync()
    expect(await openAppInWorkspace(api, ws.view(), target)).toBe(1)
    expect(ws.created).toHaveLength(2)
  })
})

describe('ссылки беседы на документ Mnemos', () => {
  const apps = [{ id: 'mnemos', title: 'Mnemos', accountId: 3, sections: [{ id: 'projects', title: 'Проекты' }] }] as never

  it('без открытия в беседе — переход в проект, как раньше', () => {
    const navigate = vi.fn()
    mnemosLinkOpener({ apps, navigate })({ project: 'hr', document: 'node-7' })?.()
    expect(navigate).toHaveBeenCalledWith({ appId: 'mnemos', search: { section: 'projects', project: 'hr', document: 'node-7', account: 3 } })
  })

  it('документ, а не приложение — переход в проект; ошибка — сообщение, без перехода', async () => {
    const navigate = vi.fn(), onError = vi.fn()
    const notApp: OpenAppInChat = vi.fn(async () => false)
    mnemosLinkOpener({ apps, navigate, openInChat: notApp, onError })({ project: 'hr', document: 'doc-1' })?.()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(notApp).toHaveBeenCalledWith({ accountId: 3, scope: 'hr', resource: 'doc-1' })
    const failing: OpenAppInChat = async () => { throw new Error('Нет подключения') }
    mnemosLinkOpener({ apps, navigate, openInChat: failing, onError })({ project: 'hr', document: 'node-7' })?.()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Не удалось открыть: Нет подключения. Повторите попытку.'))
    expect(navigate).toHaveBeenCalledOnce()
  })
})

describe('карточка гаджета в беседе', () => {
  let root: Root | undefined, host: HTMLDivElement | undefined
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined })

  it('«Открыть» показывает гаджет в панели текущей беседы, без перехода в раздел проектов; второй щелчок — тот же гаджет', async () => {
    const ws = workspace([{ id: 1, title: 'Беседа', filesRoot: '1', binding: null }])
    const navigate = vi.fn(), select = vi.fn()
    const openInChat: OpenAppInChat = async t => {
      const id = await openAppInWorkspace(api, ws.view(), t)
      if (id === null) return false
      select(id)
      return true
    }
    const gadget: SavedGadget = { saved: true, accountId: 3, projectId: 'hr', resource: 'node-7', title: 'Учёт отпусков', collaborative: true, created: true }
    // Приложение Mnemos без accountId: подключение берётся из карточки.
    const opener = mnemosLinkOpener({ apps: [{ id: 'mnemos', title: 'Mnemos', sections: [{ id: 'projects', title: 'Проекты' }] }] as never, navigate, openInChat })
    host = document.createElement('div'); document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<GadgetWorkCard gadget={gadget} projectTitle="Кадры"
      onOpen={opener({ project: gadget.projectId, document: gadget.resource, accountId: gadget.accountId, title: gadget.title })} />))
    const button = host.querySelector('button') as HTMLButtonElement
    await act(async () => { button.click(); await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(1)) })
    expect(select).toHaveBeenLastCalledWith(2)
    ws.sync()
    await act(async () => { button.click(); await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(2)) })
    expect(select).toHaveBeenLastCalledWith(2)
    expect(ws.created).toEqual(['Учёт отпусков'])
    expect(navigate).not.toHaveBeenCalled()
    expect(location.pathname).toBe('/workspace/ws-chat')
  })
})

describe('первое нажатие: гаджет выбирается, когда он уже в списке рабочего места', () => {
  it('ожидание завершается приходом гаджета в список, а не раньше; без прихода — отказ по сроку', async () => {
    const arrivals = new WorkpieceArrivals()
    arrivals.update([1])
    let arrived: boolean | undefined
    const waiting = arrivals.wait(2, 1000).then(listed => { arrived = listed })
    await Promise.resolve()
    expect(arrived).toBeUndefined()
    arrivals.update([1])
    await Promise.resolve()
    expect(arrived).toBeUndefined()
    arrivals.update([1, 2])
    await waiting
    expect(arrived).toBe(true)
    expect(await arrivals.wait(2, 1000)).toBe(true)
    expect(await arrivals.wait(3, 5)).toBe(false)
  })
})

describe('кнопка «Открыть» пока гаджет готовится', () => {
  let root: Root | undefined, host: HTMLDivElement | undefined
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined })

  it('первое нажатие сразу видно: «Открываю…», повторное нажатие не запускает второе открытие', async () => {
    let finish!: () => void
    const onOpen = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const gadget: SavedGadget = { saved: true, accountId: 3, projectId: 'hr', resource: 'node-7', title: 'Учёт отпусков', collaborative: true, created: true }
    host = document.createElement('div'); document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<GadgetWorkCard gadget={gadget} projectTitle="Кадры" onOpen={onOpen} />))
    const button = host.querySelector('button') as HTMLButtonElement
    act(() => button.click())
    expect(button.textContent).toBe('Открываю…')
    expect(button.getAttribute('aria-busy')).toBe('true')
    act(() => button.click())
    expect(onOpen).toHaveBeenCalledOnce()
    await act(async () => { finish() })
    expect(button.textContent).toBe('Открыть')
    expect(button.disabled).toBe(false)
  })
})
