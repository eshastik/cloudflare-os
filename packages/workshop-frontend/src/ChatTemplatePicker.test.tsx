// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ChatTemplatePicker, { loadChatTemplates, messageWithTemplate } from './ChatTemplatePicker'
const api = vi.hoisted(() => ({ listOutputFormats: vi.fn<(...args: unknown[]) => Promise<unknown>>(), listOwnBlueprints: vi.fn<(...args: unknown[]) => Promise<unknown>>(), listLibraryBlueprints: vi.fn<(...args: unknown[]) => Promise<unknown>>(), listFeaturedBlueprints: vi.fn<(...args: unknown[]) => Promise<unknown>>() }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
function setup() {
  api.listOutputFormats.mockResolvedValue([])
  api.listOwnBlueprints.mockResolvedValue([{ id: 'contract', title: 'Договор', description: 'Для клиента' }])
  api.listLibraryBlueprints.mockResolvedValue([{ id: 'contract', metadata: { title: 'Дубликат', description: '' } }, { id: 'report', metadata: { title: 'Отчёт', description: 'За месяц' } }])
  api.listFeaturedBlueprints.mockResolvedValue([])
}
afterEach(() => vi.clearAllMocks())
it('читает существующие Blueprints и объединяет совпадающие ID', async () => {
  setup()
  const result = await loadChatTemplates(api as never)
  expect(result.items.map(item => [item.id, item.title])).toEqual([['contract', 'Договор'], ['report', 'Отчёт']])
  expect(result.failed).toBe(0)
})
it('частичный отказ не скрывает доступные шаблоны', async () => {
  setup(); api.listFeaturedBlueprints.mockRejectedValue(new Error('offline'))
  const result = await loadChatTemplates(api as never)
  expect(result.failed).toBe(1); expect(result.items).toHaveLength(2)
})
it('ссылка сохраняет точный ID и экранирует имя шаблона', () => {
  const message = messageWithTemplate('Подготовь договор', { id: 'a/b', title: '[Договор]', description: '' }, 'https://mnemos.example')
  expect(message).toContain('Подготовь договор\n\nШаблон:')
  expect(message).toContain('https://mnemos.example/blueprint/a%2Fb')
  expect(message).toContain('\\[Договор\\]')
  expect(messageWithTemplate('Мой текст', null, 'https://mnemos.example')).toBe('Мой текст')
})
it('выбор возвращает Blueprint в беседу без создания и перехода', async () => {
  setup()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), selected = vi.fn<() => void>(), close = vi.fn<() => void>()
  try {
    await React.act(async () => root.render(<><textarea defaultValue="Неотправленная задача" /><ChatTemplatePicker onSelect={selected} onClose={close} /></>))
    const choice = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Договор'))!
    await React.act(async () => choice.click())
    expect(selected).toHaveBeenCalledWith({ id: 'contract', title: 'Договор', description: 'Для клиента' })
    expect(host.querySelector('textarea')?.value).toBe('Неотправленная задача')
    await React.act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть выбор шаблона"]')!.click())
    expect(close).toHaveBeenCalledOnce()
  } finally { await React.act(async () => root.unmount()); host.remove() }
})
