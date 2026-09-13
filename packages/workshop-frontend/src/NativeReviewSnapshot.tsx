import { useMemo, useState } from 'react'
import type { NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'

const tags = new Set('p div span br hr h1 h2 h3 h4 h5 h6 strong b em i u s strike sub sup ul ol li blockquote pre code table thead tbody tfoot tr th td caption colgroup col'.split(' '))
const styles = new Set('color background-color font-weight font-style font-size font-family text-align text-decoration white-space border border-color border-width border-style padding margin line-height vertical-align width height'.split(' '))

/** Rebuild passive document markup; no original attributes or active elements enter the preview. */
export function reviewMarkup(html: string): string {
  const template = document.createElement('template'); template.innerHTML = html
  const clean = document.createElement('template')
  function copy(node: Node, parent: Node) {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent || '')); return }
    if (!(node instanceof HTMLElement)) return
    const tag = node.localName
    if (['script', 'style', 'iframe', 'object', 'embed', 'template', 'link', 'meta', 'base', 'input', 'form'].includes(tag)) return
    const out = document.createElement(tags.has(tag) ? tag : 'span')
    for (const name of styles) {
      const value = node.style.getPropertyValue(name)
      if (value && /^[\w\s#.,%()"'-]+$/.test(value) && !/url|var|expression|attr/i.test(value)) out.style.setProperty(name, value)
    }
    for (const name of ['colspan', 'rowspan']) {
      const value = node.getAttribute(name)
      if ((tag === 'td' || tag === 'th') && value && /^[1-9][0-9]{0,2}$/.test(value)) out.setAttribute(name, value)
    }
    for (const name of tag === 'ol' ? ['start'] : tag === 'li' ? ['value'] : []) {
      const value = node.getAttribute(name)
      if (value && /^-?\d{1,10}$/.test(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647) out.setAttribute(name, value)
    }
    for (const child of node.childNodes) copy(child, out)
    parent.appendChild(out)
  }
  for (const child of template.content.childNodes) copy(child, clean.content)
  return clean.innerHTML
}

/** Render document structure in an isolated frame with no network or active content. */
export function documentPreviewSource(html: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:16px sans-serif;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:4px}</style>${reviewMarkup(html)}`
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native data')
  return value as Record<string, unknown>
}
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid native text'); return value }

/** Parse all content needed by the passive preview; unsupported data must not count as reviewed. */
export function parseNativeReview(snapshot: NativeDocumentSnapshot) {
  const doc = snapshot.document
  if (snapshot.format === 'cloudflareos.presentation') {
    if (doc.themeVersion !== 'workspace.1' || !Array.isArray(doc.slides) || !doc.slides.length || doc.slides.length > 1000) throw new Error('Invalid presentation')
    const seen = new Set<string>()
    const slides = doc.slides.map(value => {
      const slide = object(value), id = text(slide.id)
      if (!id || seen.has(id) || !Array.isArray(slide.blocks) || slide.blocks.length > 10000) throw new Error('Invalid slide')
      seen.add(id)
      const blockIds = new Set<string>()
      const paragraphs = slide.blocks.flatMap(value => {
        const block = object(value), blockId = text(block.id), props = object(block.props)
        text(block.type)
        if (!blockId || blockIds.has(blockId)) throw new Error('Invalid block')
        blockIds.add(blockId)
        return ['eyebrow', 'title', 'text', 'body', 'label', 'alt'].filter(key => key in props).map(key => text(props[key]))
      })
      return { id, paragraphs, structure: JSON.stringify(slide, null, 2) }
    })
    return { title: doc.title === undefined ? 'Презентация' : text(doc.title), sheets: [], slides }
  }
  const title = text(doc.title)
  if (snapshot.format === 'cloudflareos.document') {
    if (!Array.isArray(doc.blocks)) throw new Error()
    return { title, html: doc.blocks.map(block => reviewMarkup(text(object(block).html))).join('\n'), sheets: [] }
  }
  if (snapshot.format !== 'cloudflareos.spreadsheet' || !Array.isArray(doc.sheetOrder)) throw new Error()
  const sheets = object(doc.sheets), cells = object(doc.cells)
  return { title, sheets: doc.sheetOrder.map(id => {
    const key = text(id), source = object(sheets[key])
    const entries = Object.entries(object(cells[key])).map(([ref, cell]) => {
      if (!/^[A-Z]+[1-9][0-9]*$/.test(ref)) throw new Error()
      const data = object(cell)
      return { ref, value: text(data.value), fmt: data.fmt ? object(data.fmt) : {} }
    }).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    const ranges = source.merges ?? []
    if (!Array.isArray(ranges) || ranges.length > 1000) throw new Error('Invalid merged ranges')
    const merges = ranges.map(value => {
      const ref = text(value)
      if (!/^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(ref)) throw new Error('Invalid merged range')
      return ref
    })
    return { id: key, name: text(source.name), entries, merges }
  }) }
}

/** Read-only inspection of native data; it never writes into the active editor or evaluates formulas. */
export default function NativeReviewSnapshot({ snapshot }: { snapshot: NativeDocumentSnapshot }) {
  const [sheet, setSheet] = useState(''), [limit, setLimit] = useState(100)
  const view = useMemo(() => {
    try { return parseNativeReview(snapshot) } catch { return null }
  }, [snapshot])
  if (!view) return <p role="alert">Структура снимка не поддерживается предпросмотром. Не принимайте решение без проверки исходного документа.</p>
  const selected = view.sheets.find(s => s.id === sheet) || view.sheets[0]
  return <section>
    <h3>{view.title}</h3>
    {'html' in view && <>
      <p>Предпросмотр текста и таблиц. Активные элементы, внешние ресурсы и изображения не загружаются.</p>
      <iframe title={`Содержимое: ${view.title}`} sandbox="" className="w-full h-80 border" srcDoc={documentPreviewSource(view.html!)} />
    </>}
    {'slides' in view && view.slides && <>
      <p>Текст по слайдам. Расположение, изображения и SVG здесь не воспроизводятся; полные данные каждого слайда доступны ниже.</p>
      {view.slides.map((slide, index) => <section key={slide.id}>
        <h4>Слайд {index + 1}</h4>
        {slide.paragraphs.map((paragraph, i) => <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{paragraph}</p>)}
        <details><summary>Полная структура слайда {index + 1}</summary><pre className="overflow-auto max-h-80">{slide.structure}</pre></details>
      </section>)}
    </>}
    {selected && <>
      <p>Заполненные ячейки и исходные формулы, без пересчёта. Пустые ячейки не показаны.</p>
      <select aria-label={`Лист: ${view.title}`} value={selected.id} onChange={e => { setSheet(e.target.value); setLimit(100) }}>{view.sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <p>Объединённые диапазоны: {selected.merges.length ? selected.merges.join(', ') : 'нет'}.</p>
      <table><thead><tr><th>Ячейка</th><th>Значение или формула</th></tr></thead><tbody>{selected.entries.slice(0, limit).map(c => <tr key={c.ref}><th>{c.ref}</th><td style={{ whiteSpace: 'pre-wrap', fontWeight: c.fmt.b ? 'bold' : undefined, fontStyle: c.fmt.i ? 'italic' : undefined }}>{c.value}</td></tr>)}</tbody></table>
      {selected.entries.length > limit && <button onClick={() => setLimit(limit + 100)}>Ещё ячейки</button>}
    </>}
  </section>
}
