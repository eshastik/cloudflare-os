// @vitest-environment jsdom
import { expect, it } from 'vitest'
import type { NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import { compareSnapshots, diffWords } from './versionDiff'

const doc = (blocks: string[], title = 'Договор'): NativeDocumentSnapshot => ({ format: 'cloudflareos.document', formatVersion: 1, document: { title, blocks: blocks.map(html => ({ html })) } })

it('слова: удалённое и добавленное помечены, общее остаётся', () => {
  expect(diffWords('Неустойка 0,1 % в день', 'Неустойка 0,3 % в день')).toEqual([
    { text: 'Неустойка ', op: 'same' }, { text: '0,1', op: 'del' }, { text: '0,3', op: 'add' }, { text: ' % в день', op: 'same' },
  ])
})

it('документ: правка внутри раздела называется разделом, новые абзацы считаются, неизменённое не выдумывается', () => {
  const before = doc(['<h2>Сроки</h2><p>Поставка до 1 октября.</p>', '<h2>Оплата</h2><p>Оплата в течение 10 дней.</p>'])
  const edited = compareSnapshots(before, doc(['<h2>Сроки</h2><p>Поставка до 15 октября.</p>', '<h2>Оплата</h2><p>Оплата в течение 10 дней.</p>']))
  expect(edited.summary).toBe('изменён текст раздела «Сроки»')
  const added = compareSnapshots(before, doc(['<h2>Сроки</h2><p>Поставка до 1 октября.</p><p>Таможню оформляет поставщик.</p><p>Страховку оплачивает покупатель.</p>', '<h2>Оплата</h2><p>Оплата в течение 10 дней.</p>']))
  expect(added.summary).toBe('+2 абзаца')
  const removed = compareSnapshots(before, doc(['<h2>Сроки</h2><p>Поставка до 1 октября.</p>', '<h2>Оплата</h2>']))
  expect(removed.summary).toBe('−1 абзац')
  expect(compareSnapshots(before, before).summary).toBe('текст не изменился')
  expect(compareSnapshots(null, before).summary).toBe('первая версия, 4 абзаца')
  expect(compareSnapshots(before, doc(['<h2>Сроки</h2><p>Поставка до 1 октября.</p>', '<h2>Оплата</h2><p>Оплата в течение 10 дней.</p>'], 'Договор № 41')).summary).toBe('название «Договор № 41»')
})

it('таблица: изменённая ячейка словами, много ячеек — числом, новый лист назван', () => {
  const sheet = (cells: Record<string, string>, sheets: Record<string, string> = { s1: 'Бюджет' }): NativeDocumentSnapshot => ({ format: 'cloudflareos.spreadsheet', formatVersion: 1, document: { title: 'Бюджет', sheetOrder: Object.keys(sheets), sheets: Object.fromEntries(Object.entries(sheets).map(([id, name]) => [id, { name }])), cells: Object.fromEntries(Object.keys(sheets).map(id => [id, id === 's1' ? Object.fromEntries(Object.entries(cells).map(([ref, value]) => [ref, { value }])) : {}])) } })
  const one = compareSnapshots(sheet({ B4: '100', C1: 'Итого' }), sheet({ B4: '120', C1: 'Итого' }))
  expect(one.summary).toBe('ячейка B4: «100» → «120»')
  expect(one.kind === 'spreadsheet' && one.cells).toEqual([{ sheet: 'Бюджет', ref: 'B4', before: '100', after: '120' }])
  expect(compareSnapshots(sheet({ A1: '1', A2: '2' }), sheet({ A1: '3', A2: '4', A3: '5' })).summary).toBe('изменено: 3 ячейки')
  expect(compareSnapshots(sheet({ A1: '1' }), sheet({ A1: '1' }, { s1: 'Бюджет', s2: 'План' })).summary).toBe('+лист «План»')
})

it('презентация: изменённый слайд по номеру, добавленный и удалённый — числом', () => {
  const deck = (slides: { id: string; texts: string[] }[]): NativeDocumentSnapshot => ({ format: 'cloudflareos.presentation', formatVersion: 1, document: { themeVersion: 'workspace.1', title: 'Отчёт', slides: slides.map(s => ({ id: s.id, blocks: s.texts.map((text, i) => ({ id: `${s.id}-${i}`, type: 'title', props: { text } })) })) } })
  const base = deck([{ id: 'a', texts: ['Итоги'] }, { id: 'b', texts: ['Выручка 10 млн'] }])
  const edited = compareSnapshots(base, deck([{ id: 'a', texts: ['Итоги'] }, { id: 'b', texts: ['Выручка 12 млн'] }]))
  expect(edited.summary).toBe('текст слайда 2')
  expect(compareSnapshots(base, deck([{ id: 'a', texts: ['Итоги'] }, { id: 'b', texts: ['Выручка 10 млн'] }, { id: 'c', texts: ['Планы'] }])).summary).toBe('+1 слайд')
  expect(compareSnapshots(base, deck([{ id: 'a', texts: ['Итоги'] }])).summary).toBe('−1 слайд')
})
