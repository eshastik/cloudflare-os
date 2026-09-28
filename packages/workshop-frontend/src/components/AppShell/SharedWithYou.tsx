import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useKumoToastManager } from '@cloudflare/kumo'
import { useAuthenticatedApi } from '../../AuthContext'
import MnemosAvatar from '../MnemosAvatar'
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
  // Раздел под примерами задач: заголовок блока и список строк в рамке — как остальные списки оболочки.
  return <section aria-label="Поделились с вами" className="mt-10 flex flex-col gap-2">
    <h2 className="m-0 px-1 text-[15px] leading-5 font-semibold text-kumo-default">Поделились с вами</h2>
    <ul className="m-0 list-none overflow-hidden rounded-xl border border-kumo-line bg-kumo-overlay p-0">
      {items.slice(0, SHOWN).map((item, index) => {
        const key = `${item.accountId}/${item.scope}/${item.owner}/${item.resource}`
        const from = item.grantedByName || item.ownerName || 'коллега'
        // Открытие поднимает подключение Mnemos и рабочее место — это секунды; без видимого хода щелчок кажется пропавшим.
        return <li key={key} className={index ? 'border-t border-kumo-line' : ''}>
          <button type="button" data-shared-document="" disabled={!!opening} aria-busy={opening === key || undefined} title={sharedDocumentNote(item)} onClick={() => { void open(item) }}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kumo-ring disabled:opacity-60">
            <MnemosAvatar name={item.ownerName || 'Коллега'} id={item.owner} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] leading-5 font-medium text-kumo-default">{item.name}</span>
              <span className="block truncate text-[12px] leading-4 text-kumo-subtle">{opening === key ? 'Открываю…' : `Кто поделился: ${from}`}</span>
            </span>
            {!item.seen && <i aria-label="новое" className="h-2 w-2 shrink-0 rounded-full bg-kumo-brand" />}
          </button>
        </li>
      })}
    </ul>
  </section>
}
