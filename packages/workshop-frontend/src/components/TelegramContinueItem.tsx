import { useEffect, useState } from 'react'
import { DropdownMenu, useKumoToastManager } from '@cloudflare/kumo'
import { PaperPlaneTilt } from '@phosphor-icons/react'
import type { TelegramChatLink } from '@gadgets/workshop-shared/telegram-bot'
import { MENU_ITEM } from './menuStyles'

type TelegramLinkSource = {
  getTelegramLink(chatId: number): Promise<TelegramChatLink>
  continueInTelegram(chatId: number): Promise<TelegramChatLink>
}

// Пункт меню беседы (ADR 0027, этап 3): «Продолжить в Telegram», если у владельца подключён бот, и
// «Открыть в Telegram», если беседа уже идёт в треде. Состояние читается при каждом открытии меню:
// тред мог быть удалён в Telegram, и тогда беседу снова можно продолжить.
export function TelegramContinueItem({ overseer, chatId }: { overseer: TelegramLinkSource; chatId: number }) {
  const toasts = useKumoToastManager()
  const [link, setLink] = useState<TelegramChatLink | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLink(null)
    overseer.getTelegramLink(chatId).then(next => { if (!cancelled) setLink(next) }).catch(() => {})
    return () => { cancelled = true }
  }, [overseer, chatId])

  if (!link || link.status === 'unavailable') return null

  if (link.status === 'linked') {
    return (
      <DropdownMenu.Item onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')} className={MENU_ITEM}>
        <PaperPlaneTilt size={13} className="mr-2" aria-hidden="true" /> Открыть в Telegram
      </DropdownMenu.Item>
    )
  }

  const continueThere = async () => {
    setBusy(true)
    try {
      const next = await overseer.continueInTelegram(chatId)
      setLink(next)
      if (next.status === 'linked') {
        toasts.add({ title: `Беседа продолжается в Telegram: тред открыт у @${next.bot}`, variant: 'success' })
      } else {
        toasts.add({ title: 'Бот Telegram не подключён. Подключите его в личных настройках.', variant: 'error' })
      }
    } catch {
      toasts.add({ title: 'Не удалось открыть тред в Telegram. Повторите через минуту.', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu.Item disabled={busy} onClick={() => void continueThere()} className={MENU_ITEM}>
      <PaperPlaneTilt size={13} className="mr-2" aria-hidden="true" /> {busy ? 'Открываем тред…' : 'Продолжить в Telegram'}
    </DropdownMenu.Item>
  )
}
