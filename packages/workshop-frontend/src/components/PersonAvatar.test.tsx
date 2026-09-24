// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

// Пользователь платформы → фото из Mnemos по склейке с принципалом (общий снимок), иначе фото платформы, иначе инициалы.
const mnemos = vi.hoisted(() => new Map<string, string>([['anna', 'blob:mnemos-anna'], ['ivan', 'blob:mnemos-ivan']]))
const platform = vi.hoisted(() => new Map<string, string>([['ivan', 'blob:platform-ivan'], ['petr', 'blob:platform-petr']]))
vi.mock('../mnemosPhotos', () => ({ useUserMnemosPhoto: (id?: string | null) => (id && mnemos.get(id)) || null }))
vi.mock('../useAvatar', () => ({ useAvatar: (_api: unknown, id?: string | null) => (id && platform.get(id)) || null }))
import { PersonAvatar } from './PersonAvatar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  // Аватар грузит фото, когда виден: в тесте он виден сразу.
  vi.stubGlobal('IntersectionObserver', class { constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {} observe() { this.cb([{ isIntersecting: true }]) } disconnect() {} })
})
const closers: (() => void)[] = []
afterEach(() => { for (const close of closers.splice(0)) close() })
async function render(userId: string, name: string) {
  const el = document.createElement('div'); document.body.append(el)
  const root = createRoot(el)
  await act(async () => root.render(<PersonAvatar api={{} as never} userId={userId} name={name} />))
  closers.push(() => { act(() => root.unmount()); el.remove() })
  return el
}

it('фото из Mnemos важнее фото платформы; без связи — фото платформы; без фото — инициалы', async () => {
  expect((await render('ivan', 'Иван Смирнов')).querySelector('img')!.getAttribute('src')).toBe('blob:mnemos-ivan')
  expect((await render('petr', 'Пётр Васильев')).querySelector('img')!.getAttribute('src')).toBe('blob:platform-petr')
  const none = await render('olga', 'Ольга Кузнецова')
  expect(none.querySelector('img')).toBeNull()
  expect(none.textContent).toBe('ОК')
})

it('незагрузившееся фото Mnemos заменяется фото платформы, затем инициалами', async () => {
  const el = await render('ivan', 'Иван Смирнов')
  await act(async () => { el.querySelector('img')!.dispatchEvent(new Event('error')) })
  expect(el.querySelector('img')!.getAttribute('src')).toBe('blob:platform-ivan')
  await act(async () => { el.querySelector('img')!.dispatchEvent(new Event('error')) })
  expect(el.querySelector('img')).toBeNull()
  expect(el.textContent).toBe('ИС')
})
