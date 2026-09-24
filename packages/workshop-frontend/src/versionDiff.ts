import type { NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'

/** Кусок текста в сравнении: общий, добавленный или удалённый. */
export type Piece = { text: string; op: 'same' | 'add' | 'del' }
/** Абзац документа или текст слайда в сравнении двух версий. */
export type ParagraphChange = { op: 'same' | 'add' | 'del' | 'edit'; pieces: Piece[]; section?: string }
export type CellChange = { sheet: string; ref: string; before: string; after: string }
export type SlideChange = { number: number; op: 'add' | 'del' | 'edit' | 'layout'; paragraphs: ParagraphChange[] }
export type VersionDiff =
  | { kind: 'document'; title: [string, string]; paragraphs: ParagraphChange[]; summary: string }
  | { kind: 'spreadsheet'; title: [string, string]; cells: CellChange[]; sheets: { name: string; op: 'add' | 'del' }[]; summary: string }
  | { kind: 'presentation'; title: [string, string]; slides: SlideChange[]; summary: string }

/** Сравнение больше этого числа клеток таблицы LCS не строится: хвосты сравниваются по началу и концу. */
const LCS_LIMIT = 4_000_000

/** Наибольшая общая подпоследовательность: пары индексов совпавших элементов. */
function lcs<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): [number, number][] {
  let start = 0
  while (start < a.length && start < b.length && same(a[start]!, b[start]!)) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) { endA--; endB-- }
  const pairs: [number, number][] = []
  for (let i = 0; i < start; i++) pairs.push([i, i])
  const n = endA - start, m = endB - start
  if (n > 0 && m > 0 && n * m <= LCS_LIMIT) {
    const table = new Uint32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] = same(a[start + i]!, b[start + j]!) ? table[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(table[(i + 1) * (m + 1) + j]!, table[i * (m + 1) + j + 1]!)
    }
    let i = 0, j = 0
    while (i < n && j < m) {
      if (same(a[start + i]!, b[start + j]!)) { pairs.push([start + i, start + j]); i++; j++ }
      else if (table[(i + 1) * (m + 1) + j]! >= table[i * (m + 1) + j + 1]!) i++
      else j++
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k])
  return pairs
}

/** Выравнивание двух списков: элементы по порядку с пометкой, откуда они. */
function align<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): { op: 'same' | 'add' | 'del'; before?: T; after?: T }[] {
  const out: { op: 'same' | 'add' | 'del'; before?: T; after?: T }[] = []
  let i = 0, j = 0
  for (const [x, y] of [...lcs(a, b, same), [a.length, b.length] as [number, number]]) {
    while (i < x) out.push({ op: 'del', before: a[i++] })
    while (j < y) out.push({ op: 'add', after: b[j++] })
    if (x < a.length && y < b.length) { out.push({ op: 'same', before: a[i++], after: b[j++] }) }
  }
  return out
}

const words = (text: string) => text.match(/\s+|[^\s]+/g) ?? []

/** Разница внутри абзаца по словам; соседние куски одного вида склеиваются. */
export function diffWords(before: string, after: string): Piece[] {
  const pieces: Piece[] = []
  for (const step of align(words(before), words(after), (x, y) => x === y)) {
    const text = (step.op === 'del' ? step.before : step.after)!
    const last = pieces[pieces.length - 1]
    if (last && last.op === step.op) last.text += text; else pieces.push({ text, op: step.op })
  }
  return pieces
}

function overlap(a: string, b: string) {
  const x = new Set(words(a).filter(w => w.trim())), y = words(b).filter(w => w.trim())
  if (!x.size || !y.length) return 0
  return y.filter(w => x.has(w)).length / Math.max(x.size, y.length)
}

type Paragraph = { text: string; heading: boolean }

/** Абзацы по порядку: удалённые и добавленные рядом сливаются в «изменён», если у них есть общие слова. */
function diffParagraphs(before: Paragraph[], after: Paragraph[]): ParagraphChange[] {
  const steps = align(before, after, (x, y) => x.text === y.text)
  const out: ParagraphChange[] = []
  let section: string | undefined
  for (let k = 0; k < steps.length;) {
    if (steps[k]!.op === 'same') {
      const p = steps[k]!.after!
      if (p.heading) section = p.text
      out.push({ op: 'same', pieces: [{ text: p.text, op: 'same' }], ...(section && !p.heading ? { section } : {}) }); k++; continue
    }
    const dels: Paragraph[] = [], adds: Paragraph[] = []
    while (k < steps.length && steps[k]!.op !== 'same') { const s = steps[k++]!; if (s.op === 'del') dels.push(s.before!); else adds.push(s.after!) }
    const count = Math.max(dels.length, adds.length)
    for (let i = 0; i < count; i++) {
      const d = dels[i], a = adds[i]
      if (a?.heading) section = a.text
      const at = section && !a?.heading ? { section } : {}
      if (d && a && overlap(d.text, a.text) >= 0.3) out.push({ op: 'edit', pieces: diffWords(d.text, a.text), ...at })
      else {
        if (d) out.push({ op: 'del', pieces: [{ text: d.text, op: 'del' }], ...at })
        if (a) out.push({ op: 'add', pieces: [{ text: a.text, op: 'add' }], ...at })
      }
    }
  }
  return out
}

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,caption'

/** Текст документа по абзацам: блочные элементы без вложенных блочных, заголовки помечены. */
export function documentParagraphs(snapshot: NativeDocumentSnapshot): Paragraph[] {
  const blocks = Array.isArray(snapshot.document.blocks) ? snapshot.document.blocks : []
  const out: Paragraph[] = []
  for (const block of blocks) {
    const html = block && typeof block === 'object' && typeof (block as { html?: unknown }).html === 'string' ? (block as { html: string }).html : ''
    const template = document.createElement('template'); template.innerHTML = html
    const leaves = [...template.content.querySelectorAll(BLOCKS)].filter(e => !e.querySelector(BLOCKS))
    const items = leaves.length ? leaves.map(e => ({ text: e.textContent ?? '', heading: /^h[1-6]$/.test(e.localName) })) : [{ text: template.content.textContent ?? '', heading: false }]
    for (const item of items) { const text = item.text.replace(/\s+/g, ' ').trim(); if (text) out.push({ text, heading: item.heading }) }
  }
  return out
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
const str = (value: unknown) => typeof value === 'string' ? value : ''

function sheetCells(snapshot: NativeDocumentSnapshot) {
  const doc = snapshot.document, sheets = record(doc.sheets), cells = record(doc.cells)
  const order = Array.isArray(doc.sheetOrder) ? doc.sheetOrder.filter((id): id is string => typeof id === 'string') : Object.keys(sheets)
  return new Map(order.map(id => [id, { name: str(record(sheets[id]).name) || 'Лист', cells: new Map(Object.entries(record(cells[id])).map(([ref, cell]) => [ref, str(record(cell).value)])) }]))
}

function slideTexts(snapshot: NativeDocumentSnapshot) {
  const slides = Array.isArray(snapshot.document.slides) ? snapshot.document.slides : []
  return slides.map((value, index) => {
    const slide = record(value)
    const blocks = Array.isArray(slide.blocks) ? slide.blocks : []
    const paragraphs = blocks.flatMap(b => { const props = record(record(b).props); return ['eyebrow', 'title', 'text', 'body', 'label', 'alt'].map(k => str(props[k])).filter(Boolean) })
      .flatMap(t => t.split('\n')).map(t => t.trim()).filter(Boolean)
    return { id: str(slide.id) || `#${index}`, paragraphs, structure: JSON.stringify(slide) }
  })
}

/** Русское число с формой слова: 1 абзац, 2 абзаца, 5 абзацев. */
export function plural(n: number, one: string, few: string, many: string) {
  const tail = n % 10, hundred = n % 100
  return `${n} ${tail === 1 && hundred !== 11 ? one : tail >= 2 && tail <= 4 && (hundred < 12 || hundred > 14) ? few : many}`
}

const quote = (text: string, max = 40) => `«${text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text}»`

function documentSummary(paragraphs: ParagraphChange[], title: [string, string]) {
  const edited = paragraphs.filter(p => p.op === 'edit'), added = paragraphs.filter(p => p.op === 'add'), removed = paragraphs.filter(p => p.op === 'del')
  const parts: string[] = []
  if (title[0] !== title[1] && title[1]) parts.push(`название ${quote(title[1])}`)
  const changed = [...edited, ...added, ...removed]
  const sections = [...new Set(changed.map(p => p.section ?? ''))]
  if (edited.length === 1) parts.push(edited[0]!.section ? `изменён текст раздела ${quote(edited[0]!.section)}` : `изменён абзац ${quote(edited[0]!.pieces.map(p => p.op === 'del' ? '' : p.text).join('').trim())}`)
  else if (edited.length) parts.push(sections.length === 1 && sections[0] ? `изменён текст раздела ${quote(sections[0])}` : `изменено: ${plural(edited.length, 'абзац', 'абзаца', 'абзацев')}`)
  if (added.length) parts.push(`+${plural(added.length, 'абзац', 'абзаца', 'абзацев')}`)
  if (removed.length) parts.push(`−${plural(removed.length, 'абзац', 'абзаца', 'абзацев')}`)
  return parts.join(', ') || 'текст не изменился'
}

/** Что изменилось между двумя версиями одного документа, таблицы или презентации. before null — первая версия. */
export function compareSnapshots(before: NativeDocumentSnapshot | null, after: NativeDocumentSnapshot): VersionDiff {
  const title: [string, string] = [str(before?.document.title), str(after.document.title)]
  if (after.format === 'cloudflareos.spreadsheet') {
    const a = before ? sheetCells(before) : new Map<string, { name: string; cells: Map<string, string> }>(), b = sheetCells(after)
    const cells: CellChange[] = [], sheets: { name: string; op: 'add' | 'del' }[] = []
    for (const [id, sheet] of b) {
      const old = a.get(id)
      if (!old && before) sheets.push({ name: sheet.name, op: 'add' })
      const refs = [...new Set([...(old?.cells.keys() ?? []), ...sheet.cells.keys()])].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
      for (const ref of refs) { const was = old?.cells.get(ref) ?? '', now = sheet.cells.get(ref) ?? ''; if (was !== now) cells.push({ sheet: sheet.name, ref, before: was, after: now }) }
    }
    for (const [id, sheet] of a) if (!b.has(id)) sheets.push({ name: sheet.name, op: 'del' })
    const parts: string[] = sheets.map(s => `${s.op === 'add' ? '+' : '−'}лист ${quote(s.name)}`)
    if (!before) parts.unshift('первая версия')
    else if (cells.length === 1) parts.push(`ячейка ${cells[0]!.ref}: ${cells[0]!.before ? quote(cells[0]!.before, 16) : 'пусто'} → ${cells[0]!.after ? quote(cells[0]!.after, 16) : 'пусто'}`)
    else if (cells.length) { const names = [...new Set(cells.map(c => c.sheet))]; parts.push(`изменено: ${plural(cells.length, 'ячейка', 'ячейки', 'ячеек')}${names.length === 1 && b.size > 1 ? ` на листе ${quote(names[0]!)}` : ''}`) }
    return { kind: 'spreadsheet', title, cells, sheets, summary: parts.join(', ') || 'значения не изменились' }
  }
  if (after.format === 'cloudflareos.presentation') {
    const a = before ? slideTexts(before) : [], b = slideTexts(after)
    const slides: SlideChange[] = []
    const oldById = new Map(a.map((s, i) => [s.id, { ...s, index: i }]))
    b.forEach((slide, index) => {
      const old = oldById.get(slide.id)
      const toParagraphs = (list: string[]) => list.map(t => ({ text: t, heading: false }))
      if (!old) { if (before) slides.push({ number: index + 1, op: 'add', paragraphs: slide.paragraphs.map(t => ({ op: 'add' as const, pieces: [{ text: t, op: 'add' as const }] })) }); return }
      if (old.paragraphs.join('\n') !== slide.paragraphs.join('\n')) slides.push({ number: index + 1, op: 'edit', paragraphs: diffParagraphs(toParagraphs(old.paragraphs), toParagraphs(slide.paragraphs)) })
      else if (old.structure !== slide.structure) slides.push({ number: index + 1, op: 'layout', paragraphs: [] })
    })
    const ids = new Set(b.map(s => s.id))
    a.forEach((slide, index) => { if (!ids.has(slide.id)) slides.push({ number: index + 1, op: 'del', paragraphs: slide.paragraphs.map(t => ({ op: 'del' as const, pieces: [{ text: t, op: 'del' as const }] })) }) })
    const edited = slides.filter(s => s.op === 'edit' || s.op === 'layout'), added = slides.filter(s => s.op === 'add'), removed = slides.filter(s => s.op === 'del')
    const parts: string[] = []
    if (!before) parts.push(`первая версия, ${plural(b.length, 'слайд', 'слайда', 'слайдов')}`)
    if (edited.length === 1) parts.push(`${edited[0]!.op === 'layout' ? 'оформление' : 'текст'} слайда ${edited[0]!.number}`)
    else if (edited.length) parts.push(`изменено: ${plural(edited.length, 'слайд', 'слайда', 'слайдов')}`)
    if (added.length) parts.push(`+${plural(added.length, 'слайд', 'слайда', 'слайдов')}`)
    if (removed.length) parts.push(`−${plural(removed.length, 'слайд', 'слайда', 'слайдов')}`)
    return { kind: 'presentation', title, slides, summary: parts.join(', ') || 'слайды не изменились' }
  }
  const paragraphs = diffParagraphs(before ? documentParagraphs(before) : [], documentParagraphs(after))
  // Заголовок, повторяющий название документа, разделом не считается: иначе «раздел» — весь документ.
  for (const p of paragraphs) if (p.section && (p.section === title[0] || p.section === title[1])) delete p.section
  if (!before) return { kind: 'document', title, paragraphs, summary: `первая версия, ${plural(paragraphs.length, 'абзац', 'абзаца', 'абзацев')}` }
  return { kind: 'document', title, paragraphs, summary: documentSummary(paragraphs, title) }
}
