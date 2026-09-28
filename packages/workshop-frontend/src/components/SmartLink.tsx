import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { useRouter } from '@tanstack/react-router'

// Ссылка, которая открывает внутреннее (документ, проект, раздел, беседу) на той же странице, а в
// новой вкладке — только внешние сайты. На телефоне новая вкладка уводит человека из приложения,
// а исходная засыпает и теряет соединение.

/** Путь внутри приложения для адреса этого же сайта; null — внешний адрес. */
export function internalPath(href: string | undefined): string | null {
  if (!href) return null
  let url: URL
  try { url = new URL(href, window.location.origin) } catch { return null }
  if (url.origin !== window.location.origin || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null
  return url.pathname + url.search + url.hash
}

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> & { href: string }

export default function SmartLink({ href, onClick, children, ...rest }: Props) {
  // Вне маршрутизатора (баннер над приложением) внутренняя ссылка — обычный переход в этой вкладке.
  const router = useRouter({ warn: false }) as { history: { push(path: string): void } } | undefined
  const path = internalPath(href)
  if (path === null) {
    return <a {...rest} href={href} onClick={onClick} target="_blank" rel="noopener noreferrer">{children}</a>
  }
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || !router) return
    // Ctrl/Cmd/Shift и средняя кнопка — выбор человека открыть отдельно; не мешаем браузеру.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    router.history.push(path)
  }
  return <a {...rest} href={path} onClick={open}>{children}</a>
}
