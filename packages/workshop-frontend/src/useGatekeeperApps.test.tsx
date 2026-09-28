// @vitest-environment jsdom
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { COUNTS_RETRY_MS, useGatekeeperApps } from './useGatekeeperApps'

const auth = vi.hoisted(() => ({ authenticatedApi: { listGatekeeperApps: vi.fn<() => Promise<unknown[]>>() } }))
vi.mock('./AuthContext', () => ({ useOptionalAuthenticatedApi: () => auth }))
vi.mock('./shellReadiness', () => ({ reportShellStage: () => {} }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('меню без посчитанных счётчиков перечитывается один раз и показывает число', async () => {
  const section = (count?: number) => [{ id: 'my-work', title: 'Входящие', ...(count === undefined ? {} : { count }) }]
  auth.authenticatedApi.listGatekeeperApps
    .mockResolvedValueOnce([{ id: 'mnemos', title: 'Mnemos', sections: section(), countsPending: true }])
    .mockResolvedValueOnce([{ id: 'mnemos', title: 'Mnemos', sections: section(4), countsPending: true }])
  let seen: unknown[] = []
  function Probe() { seen = useGatekeeperApps(); return null }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const root = createRoot(document.createElement('div'))
  try {
    await React.act(async () => root.render(<Probe />))
    expect(seen).toHaveLength(1)
    await React.act(async () => { vi.advanceTimersByTime(COUNTS_RETRY_MS) })
    expect(auth.authenticatedApi.listGatekeeperApps).toHaveBeenCalledTimes(2)
    expect((seen[0] as { sections: { count?: number }[] }).sections[0].count).toBe(4)
    // Второй ответ тоже без готового числа, но перечитывание было: больше запросов нет.
    await React.act(async () => { vi.advanceTimersByTime(COUNTS_RETRY_MS * 3) })
    expect(auth.authenticatedApi.listGatekeeperApps).toHaveBeenCalledTimes(2)
  } finally { await React.act(async () => root.unmount()); vi.useRealTimers() }
})
