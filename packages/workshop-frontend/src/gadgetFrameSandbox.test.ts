import { describe, expect, it } from 'vitest'
import source from './GadgetUI.tsx?raw'
import sandboxHtml from './gadgetSandbox.ts?raw'

// 29.09 «Добавить задачу» в гаджете молча ничего не делала: фрейм без allow-forms, браузер
// отбрасывает отправку формы до onSubmit. Формы разрешены, но уйти наружу не могут.
describe('песочница фрейма гаджета', () => {
  it('разрешает формы, не даёт своего origin, а CSP запрещает отправку наружу', () => {
    const sandbox = /sandbox="([^"]+)"/.exec(source)?.[1] ?? ''
    expect(sandbox.split(' ')).toContain('allow-forms')
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandboxHtml).toContain("form-action 'none'")
    expect(sandboxHtml).toContain("connect-src 'none'")
  })
})
