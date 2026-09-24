import { useState } from 'react'
import { personInitials } from './AppShell/initials'

const tones = ['bg-selection-bg text-selection-text', 'bg-kumo-warning-tint text-kumo-warning', 'bg-kumo-info-tint text-kumo-default', 'bg-kumo-tint text-kumo-default']

/** Цвет кружка с инициалами: постоянный для человека, чтобы его узнавали в списках. */
export function avatarTone(id: string): string {
  return tones[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % tones.length]!
}

/**
 * Круглый аватар человека Mnemos: фотография, если человек её поставил, иначе инициалы имени
 * («Александр Егоров» → «АЕ»). Не загрузившаяся фотография тоже заменяется инициалами.
 */
export default function MnemosAvatar({ name, id, photo, size = 36, className = '' }: { name: string; id: string; photo?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState('')
  const show = !!photo && broken !== photo
  return <span aria-hidden="true" data-avatar={show ? 'photo' : 'initials'} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${show ? 'bg-kumo-tint' : avatarTone(id)} ${className}`}>
    {show ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(photo)} className="h-full w-full object-cover" /> : personInitials(name)}
  </span>
}
