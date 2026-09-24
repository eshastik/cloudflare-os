// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import OnboardingWizard, { WELCOME_PROMPTS } from './OnboardingWizard'
const state = vi.hoisted(() => ({
  user: { id: 'test-user', name: 'Анна' },
  navigate: vi.fn<(options: unknown) => Promise<void>>().mockResolvedValue(undefined),
  api: { setOwnDisplayName: vi.fn<() => void>(), setAvatar: vi.fn<() => void>(), completeOnboarding: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), setPreferredModel: vi.fn<() => void>(), listModels: vi.fn<() => void>(), connectAccount: vi.fn<() => void>() },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => state.navigate }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: state.api, currentUser: state.user }) }))
vi.mock('./ServerConfigContext', () => ({ useSiteName: () => 'Mnemos' }))
vi.mock('./useDocumentTitle', () => ({ useDocumentTitle: vi.fn<() => void>() }))
vi.mock('./components/SiteLogo', () => ({ default: () => null }))
let root: Root, box: HTMLDivElement
beforeEach(() => { vi.clearAllMocks(); state.user = { id: 'test-user', name: 'Анна' }; Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); box = document.createElement('div'); document.body.append(box); root = createRoot(box) })
afterEach(async () => { await React.act(async () => root.unmount()); box.remove() })
const button = (text: string) => [...box.querySelectorAll('button')].find(b => b.textContent?.includes(text))!

it('Первое знакомство — приветствие без мастера: «Начать» завершает его одним нажатием', async () => {
  const done = vi.fn<() => void>()
  await React.act(async () => root.render(<OnboardingWizard onComplete={done} />))
  expect(box.textContent).toContain('Анна, добро пожаловать')
  expect(box.querySelector('input')).toBeNull()
  await React.act(async () => button('Начать').click())
  expect(state.api.completeOnboarding).toHaveBeenCalledTimes(1)
  expect(done).toHaveBeenCalledTimes(1)
  expect(state.navigate).toHaveBeenCalledWith({ to: '/', search: {} })
  expect(state.api.setPreferredModel).not.toHaveBeenCalled()
  expect(state.api.connectAccount).not.toHaveBeenCalled()
})

it('Пример вопроса открывает беседу с этим вопросом', async () => {
  const done = vi.fn<() => void>()
  await React.act(async () => root.render(<OnboardingWizard onComplete={done} />))
  await React.act(async () => button(WELCOME_PROMPTS[1]).click())
  expect(state.navigate).toHaveBeenCalledWith({ to: '/', search: { prompt: WELCOME_PROMPTS[1] } })
  expect(done).toHaveBeenCalledTimes(1)
})

it('Имя из почты не показывается в приветствии', async () => {
  state.user = { id: 'anna.petrova@example.ru', name: 'anna.petrova' }
  await React.act(async () => root.render(<OnboardingWizard onComplete={() => {}} />))
  expect(box.querySelector('h1')?.textContent).toBe('Добро пожаловать')
})

it('Ошибка сохранения оставляет пользователя на экране и позволяет повторить попытку', async () => {
  state.api.completeOnboarding.mockRejectedValueOnce(new Error('offline'))
  const done = vi.fn<() => void>()
  await React.act(async () => root.render(<OnboardingWizard onComplete={done} />))
  await React.act(async () => button('Начать').click())
  expect(done).not.toHaveBeenCalled()
  expect(box.textContent).toContain('Не удалось начать работу')
  await React.act(async () => button('Начать').click())
  expect(done).toHaveBeenCalledTimes(1)
})
