import { describe, expect, it } from 'vitest'
import { dragChatWidth } from './chatWidth'

// Беседа стоит правее бокового меню (248 px) и полей: clientX у границы ≈ 248 + ширина беседы.
describe('перетаскивание границы беседы и документа', () => {
  const drag = { startX: 700, startWidth: 440, available: 1400 }

  it('нажатие без движения не сдвигает границу', () => {
    expect(dragChatWidth(drag, 700)).toBe(440)
  })

  it('граница идёт за курсором без смещения', () => {
    expect(dragChatWidth(drag, 760)).toBe(500)
    expect(dragChatWidth(drag, 640)).toBe(380)
  })

  it('ширина остаётся в пределах: беседа не уже 280, документ не уже 400', () => {
    expect(dragChatWidth(drag, 0)).toBe(280)
    expect(dragChatWidth(drag, 5000)).toBe(1000)
  })
})
