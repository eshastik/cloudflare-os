import { describe, expect, it } from 'vitest'
import { displayChatTitle } from './chatTitle'

describe('displayChatTitle', () => {
  it('переводит служебные названия и сохраняет пользовательские', () => {
    expect(displayChatTitle('New Chat')).toBe('Новая беседа')
    expect(displayChatTitle('  ')).toBe('Новая беседа')
    expect(displayChatTitle(undefined)).toBe('Новая беседа')
    expect(displayChatTitle('New Chat plan')).toBe('New Chat plan')
    expect(displayChatTitle('Бюджет проекта')).toBe('Бюджет проекта')
  })
})
