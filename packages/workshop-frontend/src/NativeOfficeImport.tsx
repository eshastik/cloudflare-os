import NativeOfficeUpdate from './NativeOfficeUpdate'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import type { RpcStub } from 'capnweb'
import type { GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { downloadGatekeeperOfficePreview } from './gatekeeperAppDownload'
import { uploadGatekeeperOfficePreview } from './gatekeeperAppUpload'
import { documentPreviewSource } from './NativeReviewSnapshot'
import { WorkshopButton } from './components/WorkshopControls'

type Selector = Pick<RpcStub<GatekeeperNativeDocumentWriteSelector>, 'previewOffice' | 'createOffice' | 'resumeCreation'>
type Creator = Awaited<ReturnType<Selector['createOffice']>>
type Preview = { id: string; head: string; text: string; summary: string; html?: string; source: {head:string;sha256:string}; unsupported: string[] }

/** Minimal import flow for an original already stored in the selected personal draft. */
export default function NativeOfficeImport({ selector, storageOrigin, scope, resource, name, format, receiptKey, source, retainReceipt = false, updateSelector, onBusy, onCreated }: {
  selector: Selector; storageOrigin: string; scope: string; resource: string; name: string; format: NativeDocumentFormat;
  source?: {head:string;sha256:string};
  updateSelector?: ComponentProps<typeof NativeOfficeUpdate>['selector'];
  /** A fixed Drive request retains its receipt for authorized recovery after reload. */
  retainReceipt?: boolean;
  receiptKey: string; onBusy(busy: boolean): void; onCreated(): Promise<void>;
}) {
  const [updating, setUpdating] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null), [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false)
  const [receipt, setReceipt] = useState(() => sessionStorage.getItem(receiptKey) || '')
  const creator = useRef<{ writer: Creator; head: string; upload?: string } | null>(null)
  const lifetime = useRef(new AbortController())
  useEffect(() => { const abort = new AbortController(); lifetime.current = abort; return () => { abort.abort(); creator.current?.writer[Symbol.dispose]() } }, [])
  const suffix = format === 'cloudflareos.document' ? '.cfdoc' : format === 'cloudflareos.presentation' ? '.cfslides' : '.cfsheet'
  const outputName = name.replace(/\.(docx|xlsx|pptx)$/i, '') + suffix
  function progress(value: boolean) { setBusy(value); onBusy(value) }
  async function prepare() {
    const signal = lifetime.current.signal
    progress(true); setError('')
    try {
      using result = await (source ? selector.previewOffice(scope, resource, format, source) : selector.previewOffice(scope, resource, format))
      const download = result.download
      signal.throwIfAborted()
      const text = await downloadGatekeeperOfficePreview(storageOrigin, await download.issue(), format, signal, () => download.validate())
      const snapshot = JSON.parse(text)
      if (snapshot.format !== format || snapshot.formatVersion !== 1) throw new Error()
      let summary: string, html: string | undefined
      if (format === 'cloudflareos.document') {
        html = snapshot.document.blocks.slice(0, 20).map((block: {html: string}) => { if (typeof block.html !== 'string') throw new Error(); return block.html }).join('\n')
        summary = ''
      } else if (format === 'cloudflareos.presentation') {
        summary = snapshot.document.slides.slice(0, 20).map((slide: {blocks: {props: {text?: string}}[]}, index: number) => `Слайд ${index + 1}\n${slide.blocks.map(block => block.props.text || '').filter(Boolean).join('\n')}`).join('\n\n')
      } else {
        summary = snapshot.document.sheetOrder.map((id: string) => {
          const cells = Object.entries(snapshot.document.cells[id] || {}).slice(0, 20).map(([address, cell]) => `${address}: ${(cell as {value: string}).value}`).join('\n')
          return `${snapshot.document.sheets[id].name}\n${cells}`
        }).join('\n\n')
      }
      setPreview({id: result.previewId, head: result.head, text, summary, html, source: result.source, unsupported: result.unsupported})
    } catch { if (!signal.aborted) setError('Не удалось подготовить импорт. Выберите DOCX/XLSX/PPTX в своём личном черновике и проверьте доступ.') }
    finally { if (!signal.aborted) progress(false) }
  }
  async function create() {
    const signal = lifetime.current.signal
    if (!receipt && (!preview || (preview.unsupported.length > 0 && !accepted))) return
    progress(true); setError('')
    try {
      if (!creator.current) {
        const writer = receipt ? await selector.resumeCreation(receipt, format) : await selector.createOffice(scope, outputName, format, preview!.head, preview!.id, accepted)
        if (signal.aborted) { writer[Symbol.dispose](); return }
        try {
          const state = await writer.recoveryState()
          signal.throwIfAborted()
          creator.current = {writer, head: state.head, upload: state.uploadId || undefined}
        } catch (error) { writer[Symbol.dispose](); throw error }
      }
      const target = creator.current
      if (!target.upload) target.upload = await uploadGatekeeperOfficePreview(preview!.text, storageOrigin, (size, checksum) => target.writer.issue(target.head, size, checksum), signal)
      signal.throwIfAborted()
      const savedReceipt = await target.writer.checkpoint(target.head, target.upload)
      sessionStorage.setItem(receiptKey, savedReceipt); setReceipt(savedReceipt)
      await target.writer.save(target.head, target.upload)
      signal.throwIfAborted()
      if (!retainReceipt) { sessionStorage.removeItem(receiptKey); setReceipt('') }
      setDone(true)
      await onCreated()
    } catch { if (!signal.aborted) setError('Создание не подтверждено. Повторите операцию: сохранённая заявка не создаст вторую копию. Если личный черновик изменился, подготовьте импорт заново после проверки документов.') }
    finally { if (!signal.aborted) progress(false) }
  }
  if (updating && preview && updateSelector) return <NativeOfficeUpdate
    selector={updateSelector} storageOrigin={storageOrigin} scope={scope}
    source={{node:resource,...preview.source}} format={format} receiptKey={`${receiptKey}:update`} onBusy={onBusy} />
  if (done) return <p role="status">Создана копия «{outputName}». Выберите её в списке документов, чтобы открыть в редакторе. Оригинал сохранён.</p>
  return <div className="my-3 border rounded p-3">
    {!preview && !receipt && <WorkshopButton disabled={busy} onClick={() => { void prepare() }}>Подготовить импорт {format === 'cloudflareos.document' ? 'DOCX' : format === 'cloudflareos.presentation' ? 'PPTX' : 'XLSX'}</WorkshopButton>}
    {preview && updateSelector && !receipt && <WorkshopButton disabled={busy} onClick={() => setUpdating(true)}>Обновить существующую копию</WorkshopButton>}
    {preview && <>
      <p>Новая копия: {outputName}. Оригинал сохранится отдельно.</p>
      {preview.html !== undefined
        ? <iframe title="Предпросмотр импорта DOCX" sandbox="" className="my-2 w-full h-48 border" srcDoc={documentPreviewSource(preview.html)} />
        : <pre className="my-2 max-h-48 overflow-auto whitespace-pre-wrap text-sm">{preview.summary}</pre>}
      <p className="text-sm">Показано начало документа; для таблицы — первые 20 заполненных ячеек каждого листа.</p>
      {preview.unsupported.length > 0 && <>
        <p>Следующие свойства не будут перенесены:</p>
        <ul className="max-h-32 overflow-auto text-sm">{preview.unsupported.map((item, i) => <li key={i}>{item}</li>)}</ul>
        <label><input type="checkbox" checked={accepted} disabled={busy || !!receipt} onChange={e => setAccepted(e.target.checked)} /> Создать копию с указанными потерями</label>
      </>}
    </>}
    {(preview || receipt) && <WorkshopButton disabled={busy || (!receipt && !!preview?.unsupported.length && !accepted)} onClick={() => { void create() }}>{receipt ? 'Повторить создание копии' : 'Создать нативную копию'}</WorkshopButton>}
    {busy && <p role="status">Импорт…</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
