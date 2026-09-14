import { useEffect, useRef } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { LOGOUT_EVENT } from './authNavigation'

/** Только признак: содержимое корпоративного документа остаётся внутри iframe. */
export function useUnsavedFrameChanges() {
  const dirty = useRef(false)
  const loggingOut = useRef(false)
  useEffect(() => {
    const release = () => { loggingOut.current = true }
    window.addEventListener(LOGOUT_EVENT, release)
    return () => window.removeEventListener(LOGOUT_EVENT, release)
  }, [])
  useBlocker({
    shouldBlockFn: () => !loggingOut.current && dirty.current && !window.confirm('Есть несохранённые изменения. Уйти и потерять их?'),
    enableBeforeUnload: () => !loggingOut.current && dirty.current,
  })
  return dirty
}
