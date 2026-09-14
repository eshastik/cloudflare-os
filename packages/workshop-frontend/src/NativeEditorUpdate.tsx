import { useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient, NativeEditorUpdate as Update } from '@gadgets/workshop-shared/api'
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'
import { WorkshopButton } from './components/WorkshopControls'

export default function NativeEditorUpdate({ gadget, format, snapshotSource, disabled, onUpdated }: {
  gadget: RpcStub<GadgetClient>; format: NativeDocumentFormat; snapshotSource: NativeSnapshotSourceRef; disabled?: boolean; onUpdated(): void
}) {
  const [update, setUpdate] = useState<Update | null>(null)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort
    setOpen(false); setBusy(false); setUpdate(null); setError('')
    void gadget.getNativeEditorUpdate().then(value => {
      if (!abort.signal.aborted) setUpdate(value)
    }).catch(() => {})
    return () => abort.abort()
  }, [gadget, format])

  async function apply() {
    if (!update || busy) return
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    try {
      const flush = snapshotSource.current
      if (!flush) throw new Error('Editor not ready')
      await flush(format, signal)
      signal.throwIfAborted()
      await gadget.applyNativeEditorUpdate(update.codeVersion, update.revision)
      if (!signal.aborted) { setUpdate(null); setOpen(false); onUpdated() }
    } catch {
      if (!signal.aborted) setError('Обновление не подтверждено. Проверьте сохранение документа и завершите предложенные изменения кода. Закройте раздел и откройте его заново перед повтором.')
    } finally { if (!signal.aborted) setBusy(false) }
  }

  async function show() {
    setError(''); setOpen(true); setBusy(true)
    const signal = lifetime.current.signal
    try {
      const value = await gadget.getNativeEditorUpdate()
      if (!signal.aborted) setUpdate(value)
    } catch { if (!signal.aborted) setError('Не удалось подготовить обновление редактора.') }
    finally { if (!signal.aborted) setBusy(false) }
  }

  if (!update?.changedFiles.length && !open) return null
  return <section className="flex flex-col gap-2 rounded-xl border border-kumo-line bg-kumo-base p-3 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium">Доступно обновление редактора</span>
      {!open && <WorkshopButton disabled={disabled} onClick={() => { void show() }}>Обновить редактор</WorkshopButton>}
    </div>
    {open && <>
      <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Будет установлен редактор из текущей версии платформы. Собственные изменения его кода будут заменены. Сохранённое содержимое документа останется в его хранилище.</p>
      <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Редактор перезапустится. Перед обновлением участникам нужно завершить ввод и дождаться сохранения своих правок.</p>
      {update && <p className="m-0 text-[12px] leading-4 text-kumo-subtle">Ревизия {update.revision}. Файлы: {update.changedFiles.join(', ') || 'изменений нет'}.</p>}
      {error && <p role="alert" className="m-0 text-kumo-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <WorkshopButton disabled={busy} onClick={() => setOpen(false)}>Отмена</WorkshopButton>
        <WorkshopButton tone="primary" className="!h-8" disabled={busy || !update?.changedFiles.length || !!error} onClick={() => { void apply() }}>{busy ? 'Подготовка…' : 'Сохранить ввод и обновить'}</WorkshopButton>
      </div>
    </>}
  </section>
}
