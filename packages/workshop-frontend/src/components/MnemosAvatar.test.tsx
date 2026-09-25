// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const shared = vi.hoisted(() => new Map<string, string>([['anna', 'https://objects.example/content/anna.jpg']]))
const state = vi.hoisted(() => ({ me: '', platform: null as string | null, carry: [] as unknown[][] }))
vi.mock('../mnemosPhotos', async original => ({ ...await original<typeof import('../mnemosPhotos')>(),
  useMnemosPhoto: (id?: string) => (id && shared.get(id)) || null,
  useMnemosPhotos: () => ({ me: state.me, photos: shared, origin: '' }),
  useCarryPlatformPhoto: (...args: unknown[]) => { state.carry.push(args) } }))
vi.mock('../AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: {}, currentUser: { id: 'u1', name: 'Мария Орлова' } }) }))
vi.mock('../useAvatar', () => ({ useAvatar: () => state.platform }))
import MnemosAvatar, { MyAvatar } from './MnemosAvatar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: (() => void)[] = []
afterEach(() => { for (const close of roots.splice(0)) close() })
async function render(node: React.ReactNode) {
  const el = document.createElement('div'); document.body.append(el)
  const root = createRoot(el)
  await act(async () => root.render(node))
  roots.push(() => { act(() => root.unmount()); el.remove() })
  return el
}

it('фото берётся из общего снимка по id; без фото — инициалы', async () => {
  const el = await render(<><MnemosAvatar name="Анна Петрова" id="anna" /><MnemosAvatar name="Иван Смирнов" id="ivan" /></>)
  const [anna, ivan] = [...el.querySelectorAll('[data-avatar]')]
  expect(anna!.getAttribute('data-avatar')).toBe('photo')
  expect(anna!.querySelector('img')!.getAttribute('src')).toBe('https://objects.example/content/anna.jpg')
  expect(ivan!.getAttribute('data-avatar')).toBe('initials')
  expect(ivan!.textContent).toBe('ИС')
})

it('незагрузившееся фото заменяется инициалами', async () => {
  const el = await render(<MnemosAvatar name="Анна Петрова" id="anna" />)
  await act(async () => { el.querySelector('img')!.dispatchEvent(new Event('error')) })
  expect(el.querySelector('[data-avatar]')!.getAttribute('data-avatar')).toBe('initials')
  expect(el.textContent).toBe('АП')
})

it('свой аватар без фото — инициалы своего имени', async () => {
  Object.assign(state, { me: '', platform: null })
  const el = await render(<MyAvatar size={30} />)
  expect(el.textContent).toBe('МО')
})

it('свой аватар: со связью с Mnemos — фото Mnemos, а не платформы; без фото в Mnemos — инициалы и перенос', async () => {
  Object.assign(state, { me: 'anna', platform: 'blob:platform-me', carry: [] })
  expect((await render(<MyAvatar size={30} />)).querySelector('img')!.getAttribute('src')).toBe('https://objects.example/content/anna.jpg')
  Object.assign(state, { me: 'maria' })
  const el = await render(<MyAvatar size={30} />)
  expect(el.querySelector('img')).toBeNull()
  expect(el.textContent).toBe('МО')
  expect(state.carry.at(-1)![1]).toBe('u1')
  Object.assign(state, { me: '' })
  expect((await render(<MyAvatar size={30} />)).querySelector('img')!.getAttribute('src')).toBe('blob:platform-me')
})

// Все исходники оболочки (кроме тестов) текстом: сторож ищет в них самодельные кружки с инициалами.
const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

it('сторож: кружки с инициалами людей рисуют только компоненты аватара', () => {
  // Приём самодельных инициалов: имя режется на слова и берётся первая буква каждого.
  const idiom = /split\([^)]*\)[\s\S]{0,120}?\.map\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\s*\[0\]/
  // Аватары людей: MnemosAvatar (люди Mnemos) и PersonAvatar (пользователи платформы в гаджетах).
  // Инициалы названий приложений (не людей) в боковой панели и списке гаджетов сюда не относятся.
  const allowed = new Set(['./MnemosAvatar.tsx', './PersonAvatar.tsx', './AppShell/initials.ts', './AppShell/SidebarGadgetRow.tsx', './GadgetList.tsx'])
  expect(Object.keys(sources).length).toBeGreaterThan(100)
  expect(idiom.test(sources['./AppShell/initials.ts']!)).toBe(true)
  const offenders: string[] = []
  for (const [path, source] of Object.entries(sources)) {
    if (allowed.has(path)) continue
    if (idiom.test(source)) offenders.push(`${path}: первые буквы слов имени`)
    if (/\bpersonInitials\(/.test(source)) offenders.push(`${path}: инициалы вне аватара`)
  }
  // Оба компонента аватара берут фото из общего снимка Mnemos, а не своим путём.
  expect(sources['./MnemosAvatar.tsx']).toMatch(/useMnemosPhoto\(/)
  expect(sources['./PersonAvatar.tsx']).toMatch(/useUserMnemosPhoto\(/)
  for (const [path, source] of Object.entries(sources)) if (/peoplePhotos\(\)/.test(source) && !['../mnemosPhotos.ts', '../framePersonPhotos.ts'].includes(path)) offenders.push(`${path}: своё чтение фото`)
  expect(offenders).toEqual([])
})

it('сторож одного источника: фото платформы показывается только через shownPhoto и пишется только вместе с Mnemos', () => {
  const offenders: string[] = []
  for (const [path, source] of Object.entries(sources)) {
    // Показ фото платформы в обход правила «связан с Mnemos — только Mnemos» (как было: mine || platform).
    if (/useAvatar\(/.test(source) && !['../useAvatar.ts'].includes(path) && !/shownPhoto\(/.test(source)) offenders.push(`${path}: фото платформы без shownPhoto`)
    if (/\|\|\s*platform\w*\b/.test(source)) offenders.push(`${path}: фото платформы запасным к Mnemos`)
    // Запись фото платформы в одиночку снова развела бы оболочку и встроенное приложение.
    if (/\.setAvatar\(/.test(source) && path !== '../mnemosPhotos.ts') offenders.push(`${path}: фото платформы без записи в Mnemos`)
  }
  expect(offenders).toEqual([])
})
