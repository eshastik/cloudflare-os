import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { CaretLeft, CaretRight, Minus, Plus } from '@phosphor-icons/react'

GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfOriginalViewer({ bytes }: { bytes: Blob }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1), [scale, setScale] = useState<number | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [text, setText] = useState('')
  const area = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const effectiveScale = useRef(1)
  useEffect(() => {
    let cancelled = false, task: ReturnType<typeof getDocument> | undefined
    void bytes.arrayBuffer().then(data => {
      if (cancelled) return
      task = getDocument({ data: new Uint8Array(data), useSystemFonts: true })
      return task.promise
    }).then(doc => { if (!cancelled && doc) setPdf(doc) }).catch(() => { if (!cancelled) { setError('PDF не прочитан. Возможно, файл повреждён или защищён паролем.'); setBusy(false) } })
    return () => { cancelled = true; void task?.destroy() }
  }, [bytes])
  useEffect(() => {
    if (!pdf || !canvas.current || !area.current) return
    let cancelled = false, render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    setBusy(true); setError(''); setText('')
    void pdf.getPage(page).then(async documentPage => {
      if (cancelled || !canvas.current || !area.current) return
      const base = documentPage.getViewport({ scale: 1 })
      const fit = Math.max(0.2, Math.min(1.5, (area.current.clientWidth - 40) / base.width))
      const logicalScale = scale ?? fit, ratio = window.devicePixelRatio || 1
      effectiveScale.current = logicalScale
      const viewport = documentPage.getViewport({ scale: logicalScale * ratio })
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height)
      canvas.current.style.width = `${base.width * logicalScale}px`; canvas.current.style.height = `${base.height * logicalScale}px`
      render = documentPage.render({ canvas: canvas.current, viewport })
      const textContent = await documentPage.getTextContent()
      if (!cancelled) setText(textContent.items.map(item => 'str' in item ? item.str : '').join(' '))
      await render.promise
      if (!cancelled) setBusy(false)
    }).catch(() => { if (!cancelled) { setError('Страница не отобразилась. Попробуйте открыть документ заново.'); setBusy(false) } })
    return () => { cancelled = true; render?.cancel() }
  }, [pdf, page, scale])
  const button = 'inline-flex items-center justify-center rounded-lg border border-kumo-line px-3 py-2 text-sm hover:bg-kumo-tint disabled:opacity-40'
  return <div className="flex h-full min-h-0 flex-col">
    <nav aria-label="Страницы PDF" className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-kumo-line bg-kumo-base px-3 py-2">
      <button className={button} aria-label="Предыдущая страница" disabled={page <= 1 || !pdf} onClick={() => setPage(p => p - 1)}><CaretLeft size={16} /></button>
      <label className="text-sm">Страница <input aria-label="Номер страницы" type="number" min={1} max={pdf?.numPages ?? 1} value={page} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && pdf && value <= pdf.numPages) setPage(value) }} className="w-14 rounded border border-kumo-line bg-kumo-base px-2 py-1 text-center" /> из {pdf?.numPages ?? '…'}</label>
      <button className={button} aria-label="Следующая страница" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(p => p + 1)}><CaretRight size={16} /></button>
      <button className={button} aria-label="Уменьшить масштаб PDF" disabled={!pdf || (scale !== null && scale <= 0.2)} onClick={() => setScale(s => Math.max(0.2, (s ?? effectiveScale.current) - 0.2))}><Minus size={16} /></button>
      <button className={button} onClick={() => setScale(null)}>По ширине</button>
      <button className={button} aria-label="Увеличить масштаб PDF" disabled={!pdf || (scale !== null && scale >= 3)} onClick={() => setScale(s => Math.min(3, (s ?? effectiveScale.current) + 0.2))}><Plus size={16} /></button>
    </nav>
    <div ref={area} className="relative min-h-0 flex-1 overflow-auto p-5">
      {error && <p role="alert" className="text-center">{error}</p>}
      {busy && <p role="status" className="absolute left-5 top-5 rounded-lg bg-kumo-base px-3 py-2 text-sm">Открываю страницу…</p>}
      <canvas ref={canvas} aria-label={`Страница ${page}`} role="img" className={`mx-auto block bg-white shadow-sm ${busy ? "invisible" : ""}`} />
      <details className="mx-auto mt-4 max-w-[900px] text-sm"><summary className="cursor-pointer">Текст страницы</summary><p className="whitespace-pre-wrap rounded-lg bg-kumo-base p-4 leading-relaxed">{text || 'На странице нет извлечённого текста.'}</p></details>
    </div>
  </div>
}
