import { describe, expect, it } from 'vitest'
import { isGadgetRestartLog } from './gadgetRestartLog'

describe('журнал консоли гаджета для беседы', () => {
  it('перезапуск после «Принять изменения» не считается ошибкой гаджета', () => {
    expect(isGadgetRestartLog({ level: 'error', message: ['Error: Gadget restarted due to code update.\n    at leavePresence()'] } as never)).toBe(true)
  })

  it('настоящая ошибка гаджета остаётся в журнале', () => {
    expect(isGadgetRestartLog({ level: 'error', message: ['TypeError: cannot read properties of undefined'] } as never)).toBe(false)
  })
})
