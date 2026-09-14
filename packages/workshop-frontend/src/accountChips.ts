import type { AccountDescription, SupportedResource } from '@gadgets/workshop-shared/gatekeeper'
import { receives } from './accountCapabilities'

const RECEIVER_LABELS: Array<[NonNullable<SupportedResource['receives']>, string]> = [
  ['mail', 'Почта'],
  ['calendar', 'Календарь'],
  ['drive', 'Диск'],
]

/** Чипы карточки подключённого аккаунта: только из того, что аккаунт объявил сам, без имени вендора. */
export function accountChips(description: AccountDescription, resources: SupportedResource[]): string[] {
  const chips: string[] = []
  if (description.providesUi) chips.push('Документы')
  if (description.singleton) chips.push('Агенты')
  for (const [kind, label] of RECEIVER_LABELS) if (receives(resources, kind)) chips.push(description.sourceErrors?.includes(kind) ? `${label}: ошибка подключения` : label)
  return chips
}
