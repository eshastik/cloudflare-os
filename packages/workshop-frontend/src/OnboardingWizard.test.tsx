// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import OnboardingWizard from './OnboardingWizard'
const state = vi.hoisted(() => ({
  user: { id: 'test-user', name: 'Анна' },
  api: { setOwnDisplayName: vi.fn<() => void>(), setAvatar: vi.fn<() => void>(), completeOnboarding: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), setPreferredModel: vi.fn<() => void>(), listModels: vi.fn<() => void>(), connectAccount: vi.fn<() => void>() },
}))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: state.api, currentUser: state.user }) }))
vi.mock('./ServerConfigContext', () => ({ useSiteName: () => 'Mnemos' }))
vi.mock('./useDocumentTitle', () => ({ useDocumentTitle: vi.fn<() => void>() }))
vi.mock('./components/SiteLogo', () => ({ default: () => null }))
let root: Root, box: HTMLDivElement
beforeEach(() => { vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); box = document.createElement('div'); document.body.append(box); root = createRoot(box) })
afterEach(async () => { await React.act(async () => root.unmount()); box.remove() })
it('Первый вход завершается за одно действие без выбора модели и подключения сервисов', async () => {
 const done = vi.fn<() => void>()
 await React.act(async () => root.render(<OnboardingWizard onComplete={done} />))
 expect(box.textContent).toContain('Начнём работу')
 expect(box.querySelector('input[autocomplete="name"]')).toHaveProperty('value', 'Анна')
 await React.act(async () => box.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
 expect(state.api.completeOnboarding).toHaveBeenCalledTimes(1)
 expect(done).toHaveBeenCalledTimes(1)
 expect(state.api.setPreferredModel).not.toHaveBeenCalled()
 expect(state.api.listModels).not.toHaveBeenCalled()
 expect(state.api.connectAccount).not.toHaveBeenCalled()
})
it('Ошибка сохранения оставляет пользователя на экране и позволяет повторить попытку', async () => {
 state.api.completeOnboarding.mockRejectedValueOnce(new Error('offline'))
 const done = vi.fn<() => void>()
 await React.act(async () => root.render(<OnboardingWizard onComplete={done} />))
 await React.act(async () => box.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
 expect(done).not.toHaveBeenCalled()
 expect(box.textContent).toContain('Не удалось сохранить профиль')
 expect(box.querySelector('button[type="submit"]')).toHaveProperty('disabled', false)
 await React.act(async () => box.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
 expect(done).toHaveBeenCalledTimes(1)
})
