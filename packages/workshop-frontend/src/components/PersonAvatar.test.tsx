// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

// Пользователь платформы → фото из Mnemos по склейке с принципалом (общий снимок), иначе фото платформы, иначе инициалы.
const mnemos = vi.hoisted(() => new Map<string, string>([['anna', 'blob:mnemos-anna'], ['ivan', 'blob:mnemos-ivan']]))
// Связаны с Mnemos: anna, ivan (есть фото) и olga (фото в Mnemos нет). petr связи не имеет.
const linked = vi.hoisted(() => new Set(['anna', 'ivan', 'olga']))
const platform = vi.hoisted(() => new Map<string, string>([['ivan', 'blob:platform-ivan'], ['petr', 'blob:platform-petr'], ['olga', 'blob:platform-olga']]))
vi.mock('../mnemosPhotos', async original => ({ ...await original<typeof import('../mnemosPhotos')>(),
  useUserMnemosPhoto: (id?: string | null) => ({ linked: !!id && linked.has(id), url: (id && mnemos.get(id)) || null }) }))
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

it('связь с Mnemos есть — только фото Mnemos; без связи — фото платформы; без фото — инициалы', async () => {
  expect((await render('ivan', 'Иван Смирнов')).querySelector('img')!.getAttribute('src')).toBe('blob:mnemos-ivan')
  expect((await render('petr', 'Пётр Васильев')).querySelector('img')!.getAttribute('src')).toBe('blob:platform-petr')
  // Как во встроенном приложении: связанный человек без фото в Mnemos — инициалы, даже если есть фото платформы.
  const olga = await render('olga', 'Ольга Кузнецова')
  expect(olga.querySelector('img')).toBeNull()
  expect(olga.textContent).toBe('ОК')
  const none = await render('nina', 'Нина Белова')
  expect(none.querySelector('img')).toBeNull()
  expect(none.textContent).toBe('НБ')
})

it('незагрузившееся фото Mnemos заменяется инициалами, а не фото платформы', async () => {
  const el = await render('ivan', 'Иван Смирнов')
  await act(async () => { el.querySelector('img')!.dispatchEvent(new Event('error')) })
  expect(el.querySelector('img')).toBeNull()
  expect(el.textContent).toBe('ИС')
})
