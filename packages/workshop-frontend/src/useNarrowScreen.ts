import { useEffect, useState } from 'react'

/** Ширина, ниже которой оболочка раскладывается как на телефоне (граница `md` Tailwind). */
export const NARROW_SCREEN_MAX = 767

/** Узкий экран (телефон): беседа и рабочая область показываются по очереди, а не рядом. */
export function useNarrowScreen(): boolean {
  const query = `(max-width: ${NARROW_SCREEN_MAX}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list) return
    const update = () => setNarrow(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return narrow
}
