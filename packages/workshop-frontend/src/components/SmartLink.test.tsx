// @vitest-environment jsdom
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ current: undefined as undefined | { history: { push: (path: string) => void } } }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => router.current }))

import SmartLink, { internalPath } from './SmartLink'

// Внутреннее (документ, проект, раздел, беседа) открывается на той же странице; в новой вкладке —
// только внешние сайты.

let root: Root, box: HTMLDivElement, seenPrevented = false
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
  // jsdom не умеет переходить по ссылкам: после проверки клика гасим переход у контейнера.
  box.addEventListener('click', event => { seenPrevented = event.defaultPrevented; event.preventDefault() })
  router.current = { history: { push: vi.fn<(path: string) => void>() } }
})
afterEach(async () => { await React.act(async () => root.unmount()); box.remove() })

it('адрес этого же сайта — внутренний путь; чужой сайт, почта и не-http — нет', () => {
  const origin = window.location.origin
  expect(internalPath(`${origin}/workspace/5?chat=2#m`)).toBe('/workspace/5?chat=2#m')
  expect(internalPath('/gatekeepers/mnemos')).toBe('/gatekeepers/mnemos')
  expect(internalPath('https://github.com/org/repo')).toBeNull()
  expect(internalPath('mailto:anna@example.ru')).toBeNull()
  expect(internalPath('//evil.example/x')).toBeNull()
  expect(internalPath(`${origin.replace('http:', 'https:').replace('https://', 'https://sub.')}/x`)).toBeNull()
})

it('внутренняя ссылка без target и открывается маршрутизатором на той же странице', async () => {
  await React.act(async () => root.render(<SmartLink href={`${window.location.origin}/workspace/5`}>Документ</SmartLink>))
  const a = box.querySelector('a')!
  expect(a.getAttribute('target')).toBeNull()
  expect(a.getAttribute('href')).toBe('/workspace/5')
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  await React.act(async () => { a.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(true)
  expect(router.current!.history.push).toHaveBeenCalledWith('/workspace/5')
})

it('клик с Ctrl/Cmd по внутренней ссылке остаётся за браузером', async () => {
  await React.act(async () => root.render(<SmartLink href="/workspace/5">Документ</SmartLink>))
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })
  await React.act(async () => { box.querySelector('a')!.dispatchEvent(event) })
  expect(seenPrevented).toBe(false)
  expect(router.current!.history.push).not.toHaveBeenCalled()
})

it('вне маршрутизатора внутренняя ссылка — обычный переход в этой же вкладке', async () => {
  router.current = undefined
  await React.act(async () => root.render(<SmartLink href="/projects">Проекты</SmartLink>))
  const a = box.querySelector('a')!
  expect(a.getAttribute('target')).toBeNull()
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  await React.act(async () => { a.dispatchEvent(event) })
  expect(seenPrevented).toBe(false)
})

it('внешний сайт — новая вкладка без доступа к открывшей странице', async () => {
  await React.act(async () => root.render(<SmartLink href="https://github.com/org/repo" className="x">GitHub</SmartLink>))
  const a = box.querySelector('a')!
  expect(a.getAttribute('target')).toBe('_blank')
  expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  expect(a.className).toBe('x')
})
