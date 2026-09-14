import { expect, it } from 'vitest'
import type { AccountDescription, SupportedResource } from '@gadgets/workshop-shared/gatekeeper'
import { accountChips } from './accountChips'

const avatar = { url: 'https://example.test/avatar' }
const resource = (receives: SupportedResource['receives'], title = ''): SupportedResource => ({ urlPattern: `https://example.test/${receives ?? title}`, description: '', title, receives })

it('names chips after the account description and declared receivers, never after the vendor', () => {
  const description: AccountDescription = { avatar, providesUi: { title: 'Память' }, singleton: { tsType: 'Library' } }
  const chips = accountChips(description, [resource('mail'), resource('calendar'), resource('drive'), resource(undefined, 'Repository')])
  expect(chips).toEqual(['Документы', 'Агенты', 'Почта', 'Календарь', 'Диск'])
})

it('shows nothing for an account without a management screen, singleton or receivers', () => {
  expect(accountChips({ avatar }, [resource(undefined, 'Repository')])).toEqual([])
})

it('counts each receiver kind once even when several resources declare it', () => {
  expect(accountChips({ avatar }, [resource('mail'), resource('mail')])).toEqual(['Почта'])
})
