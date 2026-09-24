// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import SharedWithYou from './SharedWithYou'

const { open, navigate, api } = vi.hoisted(() => ({ open: vi.fn<(...args: unknown[]) => Promise<boolean>>(), navigate: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}), api: {} }))
vi.mock('../../AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@cloudflare/kumo', () => ({ useKumoToastManager: () => ({ add: vi.fn() }) }))
vi.mock('../../mnemosPhotos', () => ({ useMnemosPhotos: () => ({ photos: new Map() }) }))
vi.mock('../MnemosAvatar', () => ({ default: () => null }))
vi.mock('../../sharedDocuments', () => ({
  loadSharedDocuments: async () => [{ scope: 'project', resource: 'doc', owner: 'owner', name: 'Дорожная карта', format: 'cloudflareos.document', projectName: 'Перевод', ownerName: 'Николай Деревцов', grantedByName: 'Николай Деревцов', mode: 'write', grantedAt: '2026-09-24T10:00:00Z', seen: false, accountId: 1, vendorId: 'mnemos' }],
  openSharedDocument: open,
  sharedDocumentFailure: (name: string) => `Документ «${name}» не открылся`,
  sharedDocumentNote: () => 'Николай Деревцов · можно править',
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('первый щелчок по документу коллеги сразу показывает «открываю…»; повторный щелчок второго открытия не начинает', async () => {
  let finish!: (value: boolean) => void
  open.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SharedWithYou />))
    await act(async () => { await vi.waitFor(() => expect(container.querySelector('[data-shared-document]')).not.toBeNull()) })
    const chip = () => container.querySelector('[data-shared-document]') as HTMLButtonElement
    expect(chip().textContent).not.toContain('открываю')
    await act(async () => { chip().click() })
    // Подключение Mnemos и рабочее место поднимаются секунды: щелчок виден сразу.
    expect(chip().textContent).toContain('открываю…')
    expect(chip().getAttribute('aria-busy')).toBe('true')
    await act(async () => { chip().click() })
    expect(open).toHaveBeenCalledTimes(1)
    await act(async () => { finish(true) })
    expect(chip().textContent).not.toContain('открываю')
  } finally { await act(async () => root.unmount()); container.remove() }
})
