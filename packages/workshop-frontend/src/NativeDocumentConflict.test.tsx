// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'
import NativeDocumentConflict from './NativeDocumentConflict'
const { api, preview } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<Disposable>>(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return { [Symbol.dispose]() {} } }) }, preview: { malformed: false } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperNativeDocument: async (_origin: string, _ticket: unknown, _format: string, _signal: AbortSignal, validate: () => Promise<void>) => {
  await validate()
  if (preview.malformed) return { format: 'cloudflareos.spreadsheet', formatVersion: 1, document: { title: 'Broken', sheetOrder: ['missing'], sheets: {}, cells: {} } }
  return { format: 'cloudflareos.spreadsheet', formatVersion: 1, document: { title: 'Budget', sheetOrder: ['s'], sheets: { s: { name: 'Sheet' } }, cells: { s: { B1: { value: '=A1*2' } } } } }
} }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it.each(['success', 'failure', 'malformed', 'update', 'update-failure', 'location', 'location-failure', 'delete', 'delete-failure'])('requires valid previews and never retries an uncertain resolution: %s', async scenario => {
  const fail = scenario === 'failure'
  preview.malformed = scenario === 'malformed'
  const resolve = vi.fn(async () => { if (fail) throw new Error('head moved'); return { head: 'new-head' } })
  const updateDraft = vi.fn(async () => { if (scenario === 'update-failure') throw new Error('uncertain update'); return { head: 'updated' } })
  const saveLocation = vi.fn(async () => { if (scenario === 'location-failure') throw new Error('head moved'); return { head: 'new-location' } })
  const deleteDocument = vi.fn(async () => { if (scenario === 'delete-failure') throw new Error('uncertain deletion'); return { head: 'deleted' } })
  const dispose = vi.fn()
  const conflict = {
    describe: async () => ({ head: 'frozen-head', terms: [
      { present: true, negative: false, metadata: { name: 'Budget', parent_id: 'folder', content_type: 'application/vnd.cloudflareos.spreadsheet+json' } },
      { present: true, negative: true }, { present: false, negative: false },
    ] }),
    download: async (index: number) => index === 2 ? null : { url: 'https://storage.test/data', method: 'GET', size_bytes: 1, sha256_hex: 'a'.repeat(64) },
    validate: async () => {}, resolve, [Symbol.dispose]: dispose,
  }
  api.getGatekeeperApp.mockResolvedValue({ nativeWrites: { storageOrigin: 'https://storage.test', selector: {
    publicationState: async () => ({ personal_head: 'prepared-head', shared_head: 'shared', personal_exists: true }),
    updateDraft, saveLocation, deleteDocument,
    restorationState: async () => ({ head: "delete-head", deleted: false }),
    documentLocation: async () => ({ head: 'location-head', name: 'Original', parent: 'old-folder' }),
    folders: async (_scope: string, cursor: string) => cursor ? ({ folders: [{ id: 'new-folder', name: 'Destination' }], nextCursor: '' }) : ({ folders: [], nextCursor: 'next' }),
    scopes: async () => ({ scopes: [{ id: 'project', name: 'Project' }] }),
    documents: async () => ({ documents: [{ id: 'doc', name: 'Budget' }], nextCursor: '' }),
    selectConflict: async () => conflict, [Symbol.dispose]() {},
  } } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!
  const click = async (text: string) => { expect(button(text)).toBeDefined(); await act(async () => { button(text).click() }) }
  const choose = async (label: string, value: string) => {
    const select = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
    await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  try {
    await act(async () => { root.render(<NativeDocumentConflict format="cloudflareos.spreadsheet" />) })
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('select[aria-label="Проект конфликта"]')).not.toBeNull()) })
    expect(button('Закрыть')).toBeDefined(); await choose('Проект конфликта', 'project')
    if (scenario.startsWith('update')) {
      expect(button('Получить общие правки')).toBeUndefined()
      await click('Подготовить получение общих правок')
      expect(updateDraft).not.toHaveBeenCalled()
      await click('Получить общие правки')
      expect(updateDraft).toHaveBeenCalledExactlyOnceWith('project', 'prepared-head')
      expect(button('Получить общие правки')).toBeUndefined()
      expect(document.body.textContent).toContain(scenario === 'update' ? 'Общие правки перенесены' : 'Результат не подтверждён')
      expect(resolve).not.toHaveBeenCalled()
      return
    }
    await choose('Документ конфликта', 'doc')
    if (scenario.startsWith('delete')) {
      await click('Подготовить удаление документа')
      expect(deleteDocument).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain('Общая версия и история сохранятся')
      await click('Удалить из личной версии')
      expect(deleteDocument).toHaveBeenCalledExactlyOnceWith('project', 'doc', 'delete-head', 'cloudflareos.spreadsheet')
      expect(button('Удалить из личной версии')).toBeUndefined()
      expect(document.body.textContent).toContain(scenario === 'delete' ? 'Документ удалён из личной версии' : 'Результат не подтверждён')
      return
    }
    if (scenario.startsWith('location')) {
      await click('Изменить имя и папку')
      await click('Ещё папки')
      await choose('Новая папка документа', 'new-folder')
      const input = document.querySelector('input[aria-label="Новое имя документа"]') as HTMLInputElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Renamed')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await click('Сохранить имя и папку')
      expect(saveLocation).toHaveBeenCalledExactlyOnceWith('project', 'doc', 'location-head', 'Renamed', 'new-folder', 'cloudflareos.spreadsheet')
      expect(button('Сохранить имя и папку')).toBeUndefined()
      expect(document.body.textContent).toContain(scenario === 'location' ? 'Имя и папка сохранены' : 'Результат не подтверждён')
      return
    }

    await click('Перечитать конфликт')
    expect(button('Подтвердить удаление').disabled).toBe(true)
    expect(document.body.textContent).toContain('folder')
    await click('Просмотреть вариант 1')
    if (preview.malformed) {
      expect(document.body.textContent).toContain('Результат не подтверждён')
      expect(button('Подтвердить удаление')).toBeUndefined()
      expect(resolve).not.toHaveBeenCalled()
      expect(dispose).toHaveBeenCalledOnce()
      return
    }
    expect(document.body.textContent).toContain('=A1*2')
    expect(button('Подтвердить удаление').disabled).toBe(true)
    await click('Просмотреть вариант 2')
    expect(button('Подтвердить удаление').disabled).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
    await click('Подтвердить удаление')
    expect(resolve).toHaveBeenCalledExactlyOnceWith(2)
    expect(button('Подтвердить удаление')).toBeUndefined()
    expect(document.body.textContent).toContain(fail ? 'Результат не подтверждён' : 'Выбранная сторона сохранена')
    expect(dispose).toHaveBeenCalledOnce()
  } finally { await act(async () => { root.unmount() }); host.remove() }
})
