import { useState } from 'react'
import { DropdownMenu, Tooltip, useKumoToastManager } from '@cloudflare/kumo'
import { DownloadSimple } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import type { GatekeeperNativeDocumentWriteSelector } from '@gadgets/workshop-shared/gatekeeper'
import { nativeFormatForOutput, type NativeDocumentFormat } from '@gadgets/workshop-shared/native-document'
import { WorkshopIconButton } from './components/WorkshopControls'
import { MENU_CONTENT, MENU_ITEM } from './components/menuStyles'
import { useAuthenticatedApi } from './AuthContext'
import { openNativeWritesFrame } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { makeExportFilename, saveStreamToFile } from './fileTransfers'
import { NATIVE_BINDING_EVENT, OFFICE_EXTENSION, OFFICE_LABEL, exportMnemosOffice, mnemosDocumentName, officeFilename, saveToMnemosDocument, snapshotRevision } from './nativeMnemosDocument'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'

type Props = {
  gadget: RpcStub<GadgetClient> | null
  gadgetTitle: string
  chatId?: number
  disabled?: boolean
  /** false — роль «только пользоваться»: офисной выгрузки нет, она пишет в личный черновик. */
  canImport?: boolean
  outputId?: string
  snapshotSource?: NativeSnapshotSourceRef
}

const OFFICE_MIME: Record<NativeDocumentFormat, string> = {
  'cloudflareos.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'cloudflareos.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'cloudflareos.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export default function GadgetExportMenu({ gadget, gadgetTitle, chatId, disabled, canImport, outputId, snapshotSource }: Props) {
  const [exporting, setExporting] = useState<'pdf' | 'office' | null>(null)
  const toasts = useKumoToastManager()
  const { authenticatedApi } = useAuthenticatedApi()
  const format = nativeFormatForOutput(outputId)
  const office = !!format && canImport !== false && !!snapshotSource

  const downloadPdf = async () => {
    if (!gadget || exporting) return
    setExporting('pdf')
    try {
      await saveStreamToFile(
        () => gadget.exportPdf(chatId),
        makeExportFilename(gadgetTitle, '.pdf'),
        {
          description: 'Документ PDF',
          contentType: 'application/pdf',
          extension: '.pdf',
        },
      )
    } catch (error) {
      console.error('Failed to export Gadget as PDF:', error)
      toasts.add({ title: 'Не удалось экспортировать PDF', variant: 'error' })
    } finally {
      setExporting(null)
    }
  }

  // Word, Excel и PowerPoint собирает сервер Mnemos из сохранённой личной версии документа. Поэтому
  // перед выгрузкой несохранённые правки редактора сохраняются в ту же личную версию.
  const downloadOffice = async () => {
    if (!gadget || !format || !snapshotSource || exporting) return
    setExporting('office')
    const signal = AbortSignal.timeout(120_000)
    let frame: Awaited<ReturnType<typeof openNativeWritesFrame>> | null = null
    try {
      const state = await gadget.getMnemosDocument(chatId)
      let binding = state.binding
      if (!binding) {
        toasts.add({ title: `Скачать ${OFFICE_EXTENSION[format]} можно после сохранения в проект`, description: 'Нажмите «Сохранить в проект…» в шапке документа.', variant: 'error' })
        return
      }
      frame = await openNativeWritesFrame(authenticatedApi, binding.accountId ?? undefined)
      const writes = { selector: frame.nativeWrites.selector as unknown as RpcStub<GatekeeperNativeDocumentWriteSelector>, storageOrigin: frame.nativeWrites.storageOrigin }
      const read = snapshotSource.current
      if (!read) throw new Error('Editor is not ready')
      const snapshot = await read(format, signal)
      const revision = snapshotRevision(snapshot.document)
      if (revision === undefined || revision !== binding.savedRevision) {
        const saved = await saveToMnemosDocument({ writes, format, snapshotSource, binding, signal })
        binding = { ...binding, ...(saved !== undefined ? { savedRevision: saved } : {}) }
        await gadget.setMnemosDocument(binding)
        window.dispatchEvent(new CustomEvent(NATIVE_BINDING_EVENT, { detail: { gadgetId: await gadget.getId(), format, binding } }))
      }
      const file = await exportMnemosOffice({ writes, format, binding, signal })
      const name = officeFilename(mnemosDocumentName(format, snapshot.document, gadgetTitle), format)
      await saveStreamToFile(async () => new Blob([new Uint8Array(file.bytes)], { type: file.contentType }).stream(), name,
        { description: OFFICE_LABEL[format], contentType: OFFICE_MIME[format], extension: OFFICE_EXTENSION[format] })
    } catch (error) {
      console.error('Failed to export native document to office format:', error)
      toasts.add({ title: `Не удалось скачать ${OFFICE_EXTENSION[format]}`, description: 'Проверьте подключение Mnemos и права на документ. Некоторые свойства формата пока не переносятся.', variant: 'error' })
    } finally {
      disposeGatekeeperFrame(frame)
      setExporting(null)
    }
  }

  const progress = exporting && (
    <span className="pointer-events-none absolute bottom-0 left-1 right-1 h-0.5 overflow-hidden rounded-full bg-kumo-fill">
      <span className="absolute inset-y-0 w-1/3 bg-kumo-brand animate-[thinking_1.5s_ease-in-out_infinite]" />
    </span>
  )

  if (!office) {
    return (
      <div className="flex items-center gap-2">
      <Tooltip content={exporting ? 'Экспортируется в PDF' : 'Экспорт в PDF'} asChild>
        <span className="relative inline-flex">
          <WorkshopIconButton
            aria-label="Экспорт в PDF"
            disabled={disabled || !gadget || !!exporting}
            onClick={() => { void downloadPdf() }}
          >
            <DownloadSimple size={17} />
          </WorkshopIconButton>
          {progress}
        </span>
      </Tooltip>
      </div>
    )
  }

  return (
    <div className="relative flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <WorkshopIconButton aria-label="Скачать" title={exporting ? 'Готовлю файл…' : 'Скачать'} disabled={disabled || !gadget || !!exporting}>
              <DownloadSimple size={17} />
            </WorkshopIconButton>
          }
        />
        <DropdownMenu.Content className={MENU_CONTENT}>
          <DropdownMenu.Item className={MENU_ITEM} onClick={() => { void downloadOffice() }}>{OFFICE_LABEL[format!]}</DropdownMenu.Item>
          <DropdownMenu.Item className={MENU_ITEM} onClick={() => { void downloadPdf() }}>PDF</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
      {progress}
    </div>
  )
}
