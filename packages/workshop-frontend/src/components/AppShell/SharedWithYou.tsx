import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useKumoToastManager } from '@cloudflare/kumo'
import { useAuthenticatedApi } from '../../AuthContext'
import MnemosAvatar from '../MnemosAvatar'
import { useMnemosPhotos } from '../../mnemosPhotos'
import { loadSharedDocuments, openSharedDocument, sharedDocumentFailure, sharedDocumentNote, type SharedDocumentItem } from '../../sharedDocuments'

/** Сколько недавних общих документов показывать под полем ввода; остальные — в поиске ⌘K. */
const SHOWN = 5

/**
 * «Поделились с вами» на главной: недавние документы коллег, открытые вам, пилюлями под полем ввода
 * (макет Main). Новые, ещё не открытые, отмечены точкой. Пусто — блока нет.
 */
export default function SharedWithYou() {
  const { authenticatedApi } = useAuthenticatedApi()
  const navigate = useNavigate()
  const toasts = useKumoToastManager()
  const [items, setItems] = useState<SharedDocumentItem[]>([])
  const [opening, setOpening] = useState('')
  const photos = useMnemosPhotos(authenticatedApi)
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => loadSharedDocuments(authenticatedApi))
      .then(list => { if (!cancelled) setItems(list) }, () => {})
    return () => { cancelled = true }
  }, [authenticatedApi])
  if (!items.length) return null
  async function open(item: SharedDocumentItem) {
    const key = `${item.accountId}/${item.scope}/${item.owner}/${item.resource}`
    if (opening) return
    setOpening(key)
    try {
      if (!await openSharedDocument(authenticatedApi, item, async id => { await navigate({ to: '/workspace/$id', params: { id } }) }))
        toasts.add({ title: sharedDocumentFailure(item.name), variant: 'error' })
    } catch (error) { toasts.add({ title: sharedDocumentFailure(item.name, error), variant: 'error' }) }
    finally { setOpening('') }
  }
  return <section aria-label="Поделились с вами" className="mt-8 flex flex-col items-center gap-3">
    <h2 className="m-0 text-[14px] leading-5 font-medium text-kumo-subtle">Поделились с вами</h2>
    <div className="flex flex-wrap justify-center gap-2.5">
      {items.slice(0, SHOWN).map(item => {
        const key = `${item.accountId}/${item.scope}/${item.owner}/${item.resource}`
        // Открытие поднимает подключение Mnemos и рабочее место — это секунды; без видимого хода щелчок кажется пропавшим.
        return <button key={key} type="button" data-shared-document="" disabled={!!opening} aria-busy={opening === key || undefined} title={sharedDocumentNote(item)} onClick={() => { void open(item) }}
          className="flex h-[38px] max-w-[320px] cursor-pointer items-center gap-2 rounded-full border border-kumo-fill-hover bg-kumo-overlay pr-4 pl-3 text-[14px] text-kumo-default transition-colors hover:bg-kumo-tint disabled:opacity-60">
          {!item.seen && <i aria-label="новое" className="h-2 w-2 shrink-0 rounded-full bg-kumo-brand" />}
          <MnemosAvatar name={item.ownerName || 'Коллега'} id={item.owner} photo={photos.photos.get(item.owner)} size={22} />
          <span className="truncate">«{item.name}»</span>
          <span className="shrink-0 text-kumo-subtle">· {opening === key ? 'открываю…' : item.grantedByName || item.ownerName || 'коллега'}</span>
        </button>
      })}
    </div>
  </section>
}
