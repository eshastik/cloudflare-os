// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber, GadgetClient } from '@gadgets/workshop-shared/api'
import DocumentStatus, { DOCUMENT_BIND_EVENT, DOCUMENT_SHARE_EVENT } from './DocumentStatus'
import { versionAuthor, versionLine, versionRows } from './DocumentVersionPanel'

const { api, download } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<(...args: unknown[]) => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(subscriber: ConnectedAccountsSubscriber) => Promise<unknown>>() }, download: vi.fn<(...args: any[]) => Promise<unknown>>() }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperNativeReview: vi.fn<() => Promise<null>>(), downloadGatekeeperNativeDocument: download }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

const head = 'a'.repeat(64), shared = 'b'.repeat(64)
class Empty extends RpcTarget {}
const accounts = async (subscriber: ConnectedAccountsSubscriber) => { subscriber.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); subscriber.ready(); return new RpcStub(new Empty()) }

function mount(selector: RpcTarget, downloads: RpcTarget, binding: object, extra: Record<string, unknown> = {}) {
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()),
    nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(selector) },
    nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(downloads) } }))
  api.subscribeConnectedAccounts.mockImplementation(accounts)
  class Gadget extends RpcTarget { async getId() { return 'native-doc' } async getNativeEditorUpdate() { return null } }
  class Extended extends Gadget {}
  Object.assign(Extended.prototype, extra)
  const gadget = new RpcStub(new Extended())
  const key = 'mnemos-native-binding:/:native-doc:cloudflareos.document'
  sessionStorage.setItem(key, JSON.stringify(binding))
  const snapshotSource = { current: async () => ({ format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { revision: 7, title: 'План запуска', blocks: [] } }) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)
  const click = async (text: string) => { expect(button(text), text).toBeDefined(); expect(button(text)!.disabled).toBe(false); await act(async () => button(text)!.click()) }
  const render = () => act(async () => root.render(<DocumentStatus gadget={gadget as unknown as RpcStub<GadgetClient>} format="cloudflareos.document" snapshotSource={snapshotSource} changesPollMs={0} />))
  const unmount = async () => { await act(async () => root.unmount()); container.remove(); gadget[Symbol.dispose]() }
  return { key, button, click, render, unmount }
}

it('версии: номера от старой к новой, автор одной строкой, агент — по чьей просьбе', () => {
  const rows = versionRows([
    { id: 'event-1', label: 'v1', recordedAt: '2026-08-18T10:00:00Z', actor: 'Павел', personal: false },
    { id: 'private:x', label: '', recordedAt: '2026-09-20T10:00:00Z', actor: '', author: 'Николай Деревцов', personal: true },
    { id: 'event-2', label: 'v2', recordedAt: '2026-09-02T10:00:00Z', actor: 'Агент', onBehalfOf: 'Анна', personal: false },
  ])
  expect(rows.map(r => [r.id, r.number])).toEqual([['private:x', 3], ['event-2', 2], ['event-1', 1]])
  expect(rows.map(r => versionAuthor(r))).toEqual(['Николай Деревцов', 'Агент по просьбе: Анна', 'Павел'])
  expect(versionAuthor(rows[1]!, 'Анна')).toBe('Агент по вашей просьбе')
  expect(versionLine(rows[0]!, 'изменён текст раздела «Сроки»')).toBe('Николай Деревцов: изменён текст раздела «Сроки»')
  expect(versionLine(rows[2]!, undefined)).toBe('Павел')
})

const paragraphs: Record<string, string[]> = {
  'event-1': ['Сроки', 'Поставка до 1 октября.'],
  'event-2': ['Сроки', 'Поставка до 1 октября.', 'Таможню оформляет поставщик.'],
  ['private:' + 'd'.repeat(64)]: ['Сроки', 'Поставка до 15 октября.', 'Таможню оформляет поставщик.'],
}
const snapshotOf = (id: string) => ({ format: 'cloudflareos.document', formatVersion: 1, document: { title: 'План запуска', blocks: paragraphs[id]!.map((t, i) => ({ html: i === 0 ? `<h2>${t}</h2>` : `<p>${t}</p>` })) } })

it('панель «Версии» по макету: строка «что изменилось», пилюли статуса, сравнение с выделенными правками, «Вернуть версию», без выпадающих списков и участников', async () => {
  const mine = { candidate_id: 'proposal', project_id: 'project', author_id: 'owner', personal_head: head, shared_head: shared, decision_version: 3, stale: false, ready: false,
    domains: [{ domain_id: 'Разработка', node_ids: ['doc'], approvers: ['ivan'], decisions: [] }] }
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: head, shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async documentLocation() { return { head, name: 'План запуска', parent: '' } }
    async participants() { return { head, nextCursor: '', participants: [{ id: 'ivan', name: 'Иван Петров', mode: '', canRead: true, canWrite: true }] } }
    async review() { return mine }
    async reviewerIdentity() { return 'owner' }
  }
  let validations = 0
  class Side extends RpcTarget {
    constructor(readonly id: string) { super() }
    async issue() { return { url: this.id, method: 'GET', size_bytes: 1, sha256_hex: 'c'.repeat(64), content_type: 'application/vnd.cloudflareos.document+json' } }
    async validate() { validations++ }
  }
  const selected: string[] = []
  class Downloads extends RpcTarget {
    async publications() {
      return { resourceUrl: 'https://objects.example/doc', nextCursor: '', publications: [
        { id: 'private:' + 'd'.repeat(64), recordedAt: new Date(Date.now() - 4 * 60_000).toISOString(), actor: '', format: 'cloudflareos.document' },
        { id: 'event-2', recordedAt: '2026-09-02T10:00:00Z', actor: 'Анна', format: 'cloudflareos.document' },
        { id: 'event-1', recordedAt: '2026-08-18T10:00:00Z', actor: 'Павел', format: 'cloudflareos.document' },
      ] }
    }
    async select(_scope: string, _node: string, publication: string) { selected.push(publication); return new RpcStub(new Side(publication)) }
  }
  // Как настоящая загрузка: проверка доступа зовётся ПОСЛЕ скачивания, через await. Выбранная версия к этому
  // моменту не должна быть освобождена — иначе «Сравнение не открылось» (ошибка, найденная на живой установке).
  download.mockImplementation(async (_origin: string, ticket: { url: string }, _format: string, _signal: AbortSignal, validate: () => Promise<void>) => {
    await new Promise(resolve => setTimeout(resolve, 1))
    await validate()
    return snapshotOf(ticket.url)
  })
  const restored: unknown[][] = []
  class Editor extends RpcTarget { async restoreDocumentSnapshot(...args: unknown[]) { restored.push(args) } }
  sessionStorage.setItem('mnemos-native-review:/:project', 'proposal')
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc', savedRevision: 7 }, { connectToGadget: async () => new RpcStub(new Editor()) })
  const panel = () => document.querySelector('[data-version-panel]')
  const rows = () => [...panel()!.querySelectorAll('ol[aria-label="Версии документа"] button')].map(b => b.textContent)
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toContain('Кандидат')) })
    await view.click('Версии')
    await act(async () => { await vi.waitFor(() => expect(panel()!.querySelector('h2')?.textContent).toBe('Версии «План запуска»')) })
    expect(panel()!.querySelectorAll('select, input[type="radio"]')).toHaveLength(0)
    for (const gone of ['Сменить', 'Перечитать', 'Пригласить', 'Кто видит', 'Согласование мне', 'Подключение', 'История', 'Применить']) expect(panel()!.textContent).not.toContain(gone)
    // Строка «что изменилось» — автор и разница с предыдущей версией, по скачанным версиям.
    // Загрузки идут вне act: даём им завершиться короткими шагами, каждый — отдельный act.
    for (let i = 0; i < 200 && !rows()[0]?.includes('Вы: изменён'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(rows()[0]).toContain('Вы: изменён текст раздела «Сроки»')
    expect(rows()[0]).toContain('Версия 3'); expect(rows()[0]).toContain('на согласовании')
    expect(rows()[1]).toContain('Версия 2'); expect(rows()[1]).toContain('опубликована'); expect(rows()[1]).toContain('Анна: +1 абзац')
    expect(rows()[2]).toContain('Павел: первая версия, 2 абзаца')
    expect(panel()!.textContent).toContain('Ни одна версия не пропадает. Вернуть можно любую — это станет новой версией.')
    expect(panel()!.querySelector('[data-version-primary]')?.textContent).toBe('Ждёт согласования: Иван Петров')
    expect(validations).toBe(3)
    await view.click('Сравнить 2 и 3')
    await act(async () => { await vi.waitFor(() => expect(panel()!.querySelector('[data-version-comparison]')).not.toBeNull()) })
    expect(panel()!.textContent).not.toContain('Сравнение не открылось')
    const comparison = panel()!.querySelector('[data-version-comparison]')!
    expect(comparison.querySelector('h3')?.textContent).toBe('Версия 2 → Версия 3')
    expect([...comparison.querySelectorAll('del')].map(e => e.textContent)).toEqual(['1'])
    expect([...comparison.querySelectorAll('ins')].map(e => e.textContent)).toEqual(['15'])
    // Версии скачиваются по одному разу: и подпись, и сравнение берут одну и ту же.
    expect([...selected].sort()).toEqual(['event-1', 'event-2', 'private:' + 'd'.repeat(64)])
    await act(async () => { (panel()!.querySelectorAll('ol[aria-label="Версии документа"] button')[1] as HTMLButtonElement).click() })
    expect(panel()!.querySelector('[data-version-comparison]')).toBeNull()
    expect(view.button('Сравнить 1 и 2')).toBeDefined()
    // «Вернуть версию 2»: содержимое встаёт в редактор, привязка теряет ревизию сохранения — автосохранение запишет новую версию.
    await view.click('Вернуть версию 2')
    await act(async () => { await vi.waitFor(() => expect(restored).toHaveLength(1)) })
    expect(restored[0]).toEqual([snapshotOf('event-2'), 7])
    await act(async () => { await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem(view.key)!).savedRevision).toBeUndefined()) })
    expect(JSON.parse(sessionStorage.getItem(view.key)!).savedHead).toBe(head)
    await act(async () => { (document.querySelector('button[aria-label="Назад к документу"]') as HTMLButtonElement).click() })
    expect(panel()).toBeNull()
  } finally { await view.unmount() }
})

it('смена документа — из меню «…»: «Привязать» объявляет текущую ревизию сохранённой, главное действие — «Опубликовать»', async () => {
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Команда' }] } }
    async documents() { return { documents: [{ id: 'doc', name: 'План запуска' }], nextCursor: '', truncated: false } }
    async publicationState() { return { personal_head: head, shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async participants() { return { head, nextCursor: '', participants: [] } }
    async reviewerIdentity() { return 'owner' }
  }
  class Downloads extends RpcTarget { async publications() { return { resourceUrl: '', nextCursor: '', publications: [] } } }
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc' })
  const status = () => document.querySelector('[data-document-status]')!.textContent
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(status()).toContain('сверить не с чем')) })
    expect(document.querySelector('button[data-primary-action]')?.textContent).toBe('Сохранить')
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_BIND_EVENT)) })
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Проект документа"]')?.querySelectorAll('option').length).toBe(2)) })
    const select = async (label: string, value: string) => {
      const element = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })) })
    }
    await select('Проект документа', 'project')
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Документ Mnemos в редакторе"]')?.querySelectorAll('option').length).toBe(2)) })
    await select('Документ Mnemos в редакторе', 'doc')
    await view.click('Привязать')
    await act(async () => { await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem(view.key)!).savedRevision).toBe(7)) })
    await act(async () => { await vi.waitFor(() => expect(status()).toContain('сохранено')) })
    expect(document.querySelector('button[data-primary-action]')?.textContent).toBe('Опубликовать')
  } finally { await view.unmount() }
})

it('«Поделиться»: люди списком по отделам, выбор щелчком, одна кнопка «Пригласить N»; право в строке сохраняется сразу; «Убрать»', async () => {
  const people = [
    { id: 'user-FGTK3l4q5INoE4X1', name: 'Николай Деревцов', mode: '' as string, canRead: true, canWrite: true, documentOnlyRead: false, documentOnlyWrite: false },
    { id: 'reader-1', name: 'Ольга Кузнецова', mode: 'read' as string, canRead: true, canWrite: false, documentOnlyRead: false, documentOnlyWrite: true },
    // Читает папку, но не пишет: «только документ» лишь при приглашении на правку.
    { id: 'viewer-2', name: 'Анна Смирнова', mode: '' as string, canRead: true, canWrite: false, documentOnlyRead: false, documentOnlyWrite: true },
    // Не видит папку документа: приглашение откроет ему только этот документ.
    { id: 'guest-3', name: 'Вера Гостева', mode: '' as string, canRead: false, canWrite: false, documentOnlyRead: true, documentOnlyWrite: true },
  ]
  const calls: unknown[][] = [], levelCalls: unknown[][] = []
  class Writer extends RpcTarget { async head() { return head } async access() { return 'owner' } }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: head, shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async documentLocation() { return { head, name: 'Дорожная карта', parent: '' } }
    async participants() { return { head, nextCursor: '', participants: people.map(p => ({ ...p })) } }
    async setParticipant(...args: unknown[]) {
      calls.push(args)
      const person = people.find(p => p.id === args[3])!
      if (person.mode !== args[4]) throw new Error('changed')
      person.mode = args[5] as string
    }
    async projectLevel() { return { name: 'Mnemos', level: 'department', canEdit: false, pending: null, unit: 'dev' } }
    async setProjectLevel(...args: unknown[]) { levelCalls.push(args); return { applied: true, level: 'organization', canEdit: false } }
    async departments() { return { units: [
      { id: 'dev', name: 'Разработка', members: [{ id: 'owner', name: 'Александр Егоров' }, { id: 'user-FGTK3l4q5INoE4X1', name: 'Николай Деревцов' }, { id: 'outsider', name: 'Пётр Сидоров' }] },
      { id: 'law', name: 'Юристы', members: [{ id: 'reader-1', name: 'Ольга Кузнецова' }, { id: 'viewer-2', name: 'Анна Смирнова' }, { id: 'guest-3', name: 'Вера Гостева' }] },
    ] } }
    async peoplePhotos() { return { photos: [{ id: 'reader-1', sha256: 'c'.repeat(64), url: 'https://objects.example/content/olga.jpg', expiresAt: '2026-09-24T12:00:00Z' }] } }
    async sharedDocuments() { return { documents: [] } }
    async reviewerIdentity() { return 'owner' }
  }
  class Downloads extends RpcTarget { async publications() { return { resourceUrl: '', nextCursor: '', publications: [] } } }
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc', savedRevision: 7 })
  const panel = () => document.querySelector('[data-share-panel]')!
  const candidate = (name: string) => [...panel().querySelectorAll('[data-candidate]')].find(b => b.textContent?.includes(name)) as HTMLButtonElement | undefined
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toContain('сохранено')) })
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_SHARE_EVENT)) })
    await act(async () => { await vi.waitFor(() => expect(candidate('Николай Деревцов')).toBeDefined()) })
    expect(panel().querySelector('h2')?.textContent).toBe('Поделиться')
    expect(panel().querySelector('header p')?.textContent).toBe('Дорожная карта')
    expect(panel().querySelectorAll('select')).toHaveLength(0)
    expect(panel().textContent).not.toContain('user-FGTK3l4q5INoE4X1')
    for (const gone of ['Перечитать', 'Применить']) expect(panel().textContent).not.toContain(gone)
    // Уровня проекта в панели документа нет: одна строка о проекте и ссылка на его страницу.
    expect([...panel().querySelectorAll('[role="radio"]')].map(b => b.textContent)).not.toContain('Вся организация')
    await act(async () => { await vi.waitFor(() => expect(panel().querySelector('[data-project-line]')?.textContent).toContain('Проект «Mnemos» видят: отдел «Разработка».')) })
    await act(async () => { await vi.waitFor(() => expect(panel().querySelector('[data-project-line] a')?.getAttribute('href')).toBe('/gatekeepers/memory?account=1&section=projects&project=project&view=members')) })
    expect(panel().querySelector('[data-project-line] a')?.textContent).toBe('Изменить доступ к проекту')
    // У владельца — инициалы имени, подпись «Вы» остаётся; фотография показывается вместо инициалов.
    const ownerRow = panel().querySelector('section[aria-label="Имеют доступ"] > div')!
    expect(ownerRow.querySelector('[data-avatar]')?.textContent).toBe('АЕ')
    expect(ownerRow.textContent).toContain('Вы')
    const olga = [...panel().querySelectorAll('[data-share-person]')].find(r => r.textContent?.includes('Ольга Кузнецова'))!
    expect(olga.querySelector('[data-avatar="photo"] img')?.getAttribute('src')).toBe('https://objects.example/content/olga.jpg')
    // Свой отдел раскрыт первым; чужой свёрнут; уже имеющий доступ в кандидатах не повторяется.
    expect([...panel().querySelectorAll('[data-group]')].map(g => g.getAttribute('data-group'))).toEqual(['unit:dev', 'unit:law'])
    expect(panel().querySelector('[data-group="unit:dev"]')?.textContent).toContain('Мой отдел · Разработка')
    expect(candidate('Анна Смирнова')).toBeUndefined()
    // Человек, которого сервер не предложил (отключён), виден с пометкой, но не выбирается.
    expect(candidate('Пётр Сидоров')?.textContent).toContain('нельзя пригласить')
    expect(candidate('Пётр Сидоров')?.disabled).toBe(true)
    // Кнопки «Пригласить» нет, пока никто не выбран.
    expect(panel().querySelector('[data-share-invite]')).toBeNull()
    await act(async () => { ([...panel().querySelectorAll('[data-group="unit:law"] button')][0] as HTMLButtonElement).click() })
    // Право не понижается; пометка — по выбранному праву (по умолчанию «может править»).
    expect(candidate('Анна Смирнова')?.textContent).not.toContain('может только смотреть')
    expect(candidate('Анна Смирнова')?.textContent).toContain('получит доступ только к этому документу')
    expect(candidate('Вера Гостева')?.textContent).toContain('получит доступ только к этому документу')
    expect(candidate('Вера Гостева')?.disabled).toBe(false)
    expect(candidate('Ольга Кузнецова')).toBeUndefined()
    // Поиск только фильтрует список.
    const input = panel().querySelector('input#share-person') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'никол'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect([...panel().querySelectorAll('[data-candidate]')].map(b => b.textContent?.slice(2, 18))).toEqual(['Николай Деревцов'])
    await act(async () => candidate('Николай Деревцов')!.click())
    await act(async () => { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => candidate('Анна Смирнова')!.click())
    await act(async () => candidate('Вера Гостева')!.click())
    // При выборе «может смотреть» пометка остаётся только у того, кто не видит папку.
    const rightRadio = (title: string) => [...panel().querySelectorAll('[aria-label="Право приглашённых"] [role="radio"]')].find(b => b.textContent === title) as HTMLButtonElement
    await act(async () => rightRadio('может смотреть').click())
    expect(candidate('Анна Смирнова')?.textContent).not.toContain('получит доступ только к этому документу')
    expect(candidate('Вера Гостева')?.textContent).toContain('получит доступ только к этому документу')
    await act(async () => rightRadio('может править').click())
    expect(panel().querySelector('[data-share-invite]')?.textContent).toBe('Пригласить 3')
    await act(async () => (panel().querySelector('[data-share-invite]') as HTMLButtonElement).click())
    await act(async () => { await vi.waitFor(() => expect(calls).toHaveLength(3)) })
    expect(calls[0]).toEqual(['project', 'doc', head, 'user-FGTK3l4q5INoE4X1', '', 'write'])
    expect(calls[1]).toEqual(['project', 'doc', head, 'viewer-2', '', 'write'])
    expect(calls[2]).toEqual(['project', 'doc', head, 'guest-3', '', 'write'])
    await act(async () => { await vi.waitFor(() => expect(panel().textContent).toContain('получат уведомление во «Входящих» и письмо')) })
    expect(panel().textContent).toContain('Только этот документ, без папки проекта: Анна Смирнова, Вера Гостева')
    expect(panel().querySelector('[data-share-invite]')).toBeNull()
    // Право меняется в строке и сохраняется сразу.
    const row = () => [...panel().querySelectorAll('[data-share-person]')].find(r => r.textContent?.includes('Николай Деревцов'))!
    await act(async () => { await vi.waitFor(() => expect(row()).toBeDefined()) })
    expect(row().textContent).toContain('может править')
    await act(async () => { (row().querySelector('button[aria-label="Право: Николай Деревцов"]') as HTMLButtonElement).click() })
    await act(async () => { ([...row().querySelectorAll('[role="menuitemradio"]')].find(b => b.textContent === 'может смотреть') as HTMLButtonElement).click() })
    await act(async () => { await vi.waitFor(() => expect(calls).toHaveLength(4)) })
    expect(calls[3]).toEqual(['project', 'doc', head, 'user-FGTK3l4q5INoE4X1', 'write', 'read'])
    await act(async () => { await vi.waitFor(() => expect(row().textContent).toContain('может смотреть')) })
    await act(async () => { ([...row().querySelectorAll('button')].find(b => b.textContent === 'Убрать') as HTMLButtonElement).click() })
    await act(async () => { await vi.waitFor(() => expect(calls).toHaveLength(5)) })
    expect(calls[4]).toEqual(['project', 'doc', head, 'user-FGTK3l4q5INoE4X1', 'read', ''])
    // У приглашённого без папки в списке «Имеют доступ» — пометка.
    const guestRow = [...panel().querySelectorAll('[data-share-person]')].find(r => r.textContent?.includes('Вера Гостева'))
    expect(guestRow?.textContent).toContain('только этот документ')
    await act(async () => { await vi.waitFor(() => expect(panel().textContent).toContain('больше не видит документ')) })
    // Недавние: приглашённые в этом браузере наверху.
    await act(async () => { await vi.waitFor(() => expect(panel().querySelector('[data-group="recent"]')?.textContent).toContain('Николай Деревцов')) })
    // Человек из «Недавних» в группе отдела не повторяется.
    expect(panel().querySelector('[data-group="unit:dev"]')?.textContent ?? '').not.toContain('Николай Деревцов')
    // Ни одно действие в панели документа не меняет видимость проекта.
    for (const b of [...panel().querySelectorAll('button')]) expect(b.textContent).not.toMatch(/Вся организация|Мой отдел$/)
    expect(levelCalls).toHaveLength(0)
  } finally { await view.unmount(); localStorage.clear() }
})

it('приглашённому «Поделиться» объясняет, что приглашает владелец; шапка — общий документ без публикации', async () => {
  class Writer extends RpcTarget { async head() { return head } async access() { return 'write' } }
  class Selector extends RpcTarget {
    async publicationState() { return { personal_head: 'e'.repeat(64), shared_head: shared, personal_exists: true } }
    async select() { return new RpcStub(new Writer()) }
    async selectConflict() { throw new Error('No conflict') }
    async sharedDocuments() { return { documents: [{ scope: 'project', resource: 'doc', owner: 'owner', name: 'Дорожная карта', format: 'cloudflareos.document', projectName: 'Mnemos', ownerName: 'Николай Деревцов', grantedByName: 'Николай Деревцов', mode: 'write', grantedAt: '2026-09-24T10:00:00Z', seen: false, documentOnly: true }] } }
    async participants() { throw new Error('owner only') }
    async reviewerIdentity() { return 'mnemos-owner' }
  }
  class Downloads extends RpcTarget { async publications() { return { resourceUrl: '', nextCursor: '', publications: [] } } }
  const view = mount(new Selector(), new Downloads(), { accountId: null, scope: 'project', resource: 'doc', savedRevision: 7, savedHead: head })
  try {
    await view.render()
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toContain('Общий документ')) })
    expect(document.querySelector('button[data-primary-action]')).toBeNull()
    await act(async () => { window.dispatchEvent(new CustomEvent(DOCUMENT_SHARE_EVENT)) })
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-share-panel]')?.textContent).toContain('Приглашать других может его владелец')) })
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('[data-share-panel]')?.textContent).toContain('Вам открыт только он, без папки проекта.')) })
    expect(document.querySelector('[data-share-panel] h2')?.textContent).toBe('Поделиться')
    expect(document.querySelector('[data-share-invite]')).toBeNull()
  } finally { await view.unmount() }
})
