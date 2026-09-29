import { expect, test } from 'vitest'
import { rightTabs } from './gadgetEditorTabs'

test('у приложения из проекта нет вкладки «Код»; у гаджета беседы и документа она есть', () => {
  expect(rightTabs(undefined, true).map(t => t.label)).not.toContain('Код')
  expect(rightTabs(undefined, false).map(t => t.label)).toContain('Код')
  expect(rightTabs({ id: 'cloudflareos.document', noun: 'Документ' } as never).map(t => t.value)).toEqual(['app', 'code', 'connections'])
})
