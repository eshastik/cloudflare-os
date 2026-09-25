import { useState } from 'react'
import { personInitials } from './AppShell/initials'
import { shownPhoto, useCarryPlatformPhoto, useMnemosPhoto, useMnemosPhotos } from '../mnemosPhotos'
import { useAuthenticatedApi } from '../AuthContext'
import { useAvatar } from '../useAvatar'

const tones = ['bg-selection-bg text-selection-text', 'bg-kumo-warning-tint text-kumo-warning', 'bg-kumo-info-tint text-kumo-default', 'bg-kumo-tint text-kumo-default']

/** Цвет кружка с инициалами: постоянный для человека, чтобы его узнавали в списках. */
export function avatarTone(id: string): string {
  return tones[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % tones.length]!
}

/**
 * Единственный кружок человека Mnemos в оболочке: фотография, если человек её поставил, иначе инициалы
 * имени («Александр Егоров» → «АЕ»). Не загрузившаяся фотография тоже заменяется инициалами.
 * Фото берётся из общего снимка по id; photo передаётся, только когда картинка своя (профиль с фото
 * платформы). Сторож personAvatarGuard.test.ts не даёт экранам рисовать инициалы самим.
 */
export default function MnemosAvatar({ name, id, photo, size = 36, className = '' }: { name: string; id: string; photo?: string | null; size?: number; className?: string }) {
  const shared = useMnemosPhoto(photo === undefined ? id : undefined)
  const src = photo === undefined ? shared : photo
  const [broken, setBroken] = useState('')
  const show = !!src && broken !== src
  return <span aria-hidden="true" data-avatar={show ? 'photo' : 'initials'} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${show ? 'bg-kumo-tint' : avatarTone(id)} ${className}`}>
    {show ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(src)} className="h-full w-full object-cover" /> : personInitials(name)}
  </span>
}

/**
 * Свой аватар (меню, низ панели, настройки). Связь с Mnemos есть — фото в Mnemos, как его видят коллеги
 * во встроенном приложении; нет связи — фото платформы; иначе инициалы. Здесь же — разовый перенос фото
 * платформы в Mnemos: низ панели виден на каждой странице, поэтому перенос случается при первом входе.
 */
export function MyAvatar({ size, className }: { size: number; className?: string }) {
  const { authenticatedApi, currentUser } = useAuthenticatedApi()
  const platform = useAvatar(authenticatedApi, currentUser?.id)
  const book = useMnemosPhotos(authenticatedApi)
  useCarryPlatformPhoto(authenticatedApi, currentUser?.id, book)
  const photo = shownPhoto({ linked: !!book.me, url: book.me ? book.photos.get(book.me) ?? null : null }, platform)
  return <MnemosAvatar name={currentUser?.name || ''} id={book.me || currentUser?.id || 'me'} photo={photo} size={size} className={className} />
}
