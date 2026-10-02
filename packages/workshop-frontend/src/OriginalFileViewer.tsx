import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowDown, ChatCircleText, Minus, Plus, X } from '@phosphor-icons/react'
import { prepareDocumentFile, type DocumentFileDownload } from './saveMailAttachment'

const PdfOriginalViewer = lazy(() => import('./PdfOriginalViewer'))

export type OriginalFileView = { name: string; load: (signal: AbortSignal) => Promise<Blob>; ask: () => void }

export default function OriginalFileViewer({ file, onClose }: { file: OriginalFileView; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [download, setDownload] = useState<DocumentFileDownload | null>(null)
  const [content, setContent] = useState<string>('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [bytes, setBytes] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(() => /\.docx$/i.test(file.name) && window.innerWidth < 700 ? 40 : 100)
  const [retry, setRetry] = useState(0)
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const kind = extension === 'pdf' ? 'pdf' : extension === 'docx' ? 'docx' : /^(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(extension) ? 'image' : /^(md|markdown)$/.test(extension) ? 'markdown' : /^(txt|csv|tsv|log|json|ya?ml|xml|html|css|js|jsx|ts|tsx|py|rs|go|sh|sql|toml|ini)$/.test(extension) ? 'text' : 'unsupported'
  useEffect(() => {
    dialog.current?.showModal()
    return () => dialog.current?.close()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false, prepared: DocumentFileDownload | undefined, url: string | undefined
    setDownload(null); setContent(''); setPreviewUrl(''); setBytes(null); setError('')
    void file.load(controller.signal).then(async bytes => {
      if (disposed) return
      prepared = prepareDocumentFile(bytes, file.name)
      setDownload(prepared)
      setBytes(bytes)
      if (kind === 'image') {
        const imageMime = extension === 'svg' ? 'image/svg+xml' : /^(jpg|jpeg)$/.test(extension) ? 'image/jpeg' : `image/${extension}`
        url = URL.createObjectURL(new Blob([bytes], { type: imageMime }))
        setPreviewUrl(url)
      }
      if (kind === 'docx') {
        const { renderOriginalDocx } = await import('./originalDocx')
        const html = await renderOriginalDocx(bytes)
        if (!disposed) setContent(html)
      } else if (kind === 'text' || kind === 'markdown') {
        const text = await bytes.text()
        if (!disposed) setContent(text)
      }
    }).catch(() => { if (!disposed) setError('Документ не открылся. Проверьте доступ и повторите попытку.') })
    return () => { disposed = true; controller.abort(); prepared?.dispose(); if (url) URL.revokeObjectURL(url) }
  }, [file, retry])
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-kumo-line px-3 py-2 text-sm hover:bg-kumo-tint disabled:opacity-50'
  const loaded = !!download && (kind !== 'docx' || !!content)
  return <dialog ref={dialog} aria-label={`Просмотр: ${file.name}`} onCancel={onClose} className="fixed inset-0 m-auto h-[94dvh] max-h-none w-[96vw] max-w-[1500px] overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base p-0 text-kumo-default shadow-xl backdrop:bg-black/40">
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-kumo-line px-4 py-3">
        <div className="min-w-0 flex-1 max-sm:w-full max-sm:flex-none"><h2 className="m-0 truncate text-base font-semibold" title={file.name}>{file.name}</h2><p className="m-0 text-xs text-kumo-subtle">Просмотр оригинала</p></div>
        {kind !== 'pdf' && <div className="flex items-center gap-1"><button className={button} aria-label="Уменьшить масштаб" disabled={zoom <= 20} onClick={() => setZoom(z => z - 10)}><Minus size={16} /></button><button className={button} title="Вернуть масштаб" onClick={() => setZoom(100)}>{zoom}%</button><button className={button} aria-label="Увеличить масштаб" disabled={zoom >= 200} onClick={() => setZoom(z => z + 10)}><Plus size={16} /></button></div>}
        <button className={button} aria-label="Спросить Mnemos" onClick={() => { onClose(); file.ask() }}><ChatCircleText size={18} /><span className="max-sm:hidden">Спросить Mnemos</span></button>
        <button className={button} aria-label="Скачать оригинал" disabled={!download} onClick={() => download?.save()}><ArrowDown size={18} /><span className="max-sm:hidden">Скачать</span></button>
        <button className={button} aria-label="Закрыть просмотр" onClick={onClose}><X size={18} /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-kumo-tint">
        {error ? <div role="alert" className="p-8 text-center"><p>{error}</p><button className={button} onClick={() => setRetry(n => n + 1)}>Повторить</button></div> : !loaded ? <p role="status" className="p-8 text-center text-sm">Открываю документ…</p> : kind === 'pdf' ? <Suspense fallback={<p role="status" className="p-6 text-center">Открываю PDF…</p>}><PdfOriginalViewer bytes={bytes!} /></Suspense> : kind === 'docx' ? <iframe title={file.name} sandbox="" srcDoc={content.replace('/* reader-scale */', `body { zoom: ${zoom / 100}; }`)} className="h-full w-full border-0" /> : kind === 'image' ? <div className="flex min-h-full items-start justify-center p-6"><img alt={file.name} src={previewUrl} style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : undefined, objectFit: 'contain' }} /></div> : kind === 'markdown' ? <article className="mx-auto my-6 max-w-[900px] rounded-lg bg-kumo-base p-8 leading-relaxed [&_h1]:text-3xl [&_h2]:text-2xl [&_h3]:text-xl [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:my-4 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-6 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_pre]:overflow-auto [&_pre]:bg-kumo-tint [&_pre]:p-4" style={{ fontSize: `${zoom}%` }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></article> : kind === 'text' ? <pre className="m-6 min-w-max rounded-lg bg-kumo-base p-6 font-mono leading-6" style={{ fontSize: 14 * zoom / 100 }}>{content}</pre> : <div className="p-8 text-center"><p>Для этого формата пока нет встроенного просмотра.</p><button className={button} onClick={() => download?.save()}>Скачать и открыть на компьютере</button></div>}
      </main>
    </div>
  </dialog>
}
