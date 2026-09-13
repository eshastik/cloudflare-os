import NativeDocumentOpen from './NativeDocumentOpen'
import NativeEditorUpdate from './NativeEditorUpdate'
import { useState } from 'react'
import { Tooltip, useKumoToastManager } from '@cloudflare/kumo'
import { DownloadSimple } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { GadgetClient } from '@gadgets/workshop-shared/api'
import { WorkshopIconButton } from './components/WorkshopControls'
import { makeExportFilename, saveStreamToFile } from './fileTransfers'
import NativeDocumentSave from './NativeDocumentSave'
import NativeDocumentParticipants from './NativeDocumentParticipants'
import NativeDocumentConflict from './NativeDocumentConflict'
import NativeDocumentPublication from './NativeDocumentPublication'
import NativeDocumentReviewInbox from './NativeDocumentReviewInbox'
import type { NativeSnapshotSourceRef } from './nativeSnapshotSource'

type Props = {
  gadget: RpcStub<GadgetClient> | null
  gadgetTitle: string
  chatId?: number
  disabled?: boolean
  canImport?: boolean
  outputId?: string
  snapshotSource?: NativeSnapshotSourceRef
}

export default function GadgetExportMenu({ gadget, gadgetTitle, chatId, disabled, outputId, snapshotSource, canImport = true }: Props) {
  const [exporting, setExporting] = useState(false)
  const toasts = useKumoToastManager()
  const nativeFormat = outputId === 'document' ? 'cloudflareos.document' : outputId === 'spreadsheet' ? 'cloudflareos.spreadsheet' : outputId === 'presentation' ? 'cloudflareos.presentation' : null

  const download = async () => {
    if (!gadget || exporting) return

    setExporting(true)
    try {
      await saveStreamToFile(
        () => gadget.exportPdf(chatId),
        makeExportFilename(gadgetTitle, '.pdf'),
        {
          description: 'PDF document',
          contentType: 'application/pdf',
          extension: '.pdf',
        },
      )
    } catch (error) {
      console.error('Failed to export Gadget as PDF:', error)
      toasts.add({ title: 'Failed to export PDF', variant: 'error' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
    {gadget && snapshotSource && nativeFormat && <NativeDocumentSave
      gadget={gadget} chatId={chatId} disabled={disabled}
      snapshotSource={snapshotSource}
      format={nativeFormat} />}
    {gadget && nativeFormat && <NativeDocumentConflict
      key={`conflict:${chatId ?? 'workspace'}`} context={gadget} disabled={disabled}
      format={nativeFormat} />}
    {gadget && nativeFormat && <NativeDocumentParticipants
      key={chatId ?? 'workspace'} context={gadget} disabled={disabled}
      format={nativeFormat} />}
    {gadget && nativeFormat && <NativeDocumentPublication
      key={`publication:${chatId ?? 'workspace'}`} context={gadget} disabled={disabled} />}
    {gadget && nativeFormat && <NativeDocumentReviewInbox
      key={`review:${chatId ?? 'workspace'}`} context={gadget} disabled={disabled}
      format={nativeFormat} />}
    {gadget && snapshotSource && chatId === undefined && nativeFormat && <NativeEditorUpdate
      gadget={gadget} disabled={disabled} snapshotSource={snapshotSource} onUpdated={() => window.location.reload()}
      format={nativeFormat} />}
    {canImport && gadget && snapshotSource && chatId === undefined && nativeFormat && <NativeDocumentOpen
      gadget={gadget} disabled={disabled} snapshotSource={snapshotSource} reconnect={() => window.location.reload()}
      format={nativeFormat} />}
    <Tooltip content={exporting ? 'Exporting to PDF' : 'Export to PDF'} asChild>
      <span className="relative inline-flex">
        <WorkshopIconButton
          aria-label="Export to PDF"
          disabled={disabled || !gadget || exporting}
          onClick={() => { void download() }}
        >
          <DownloadSimple size={17} />
        </WorkshopIconButton>
        {exporting && (
          <span className="pointer-events-none absolute bottom-0 left-1 right-1 h-0.5 overflow-hidden rounded-full bg-kumo-fill">
            <span className="absolute inset-y-0 w-1/3 bg-kumo-brand animate-[thinking_1.5s_ease-in-out_infinite]" />
          </span>
        )}
      </span>
    </Tooltip>
    </div>
  )
}
