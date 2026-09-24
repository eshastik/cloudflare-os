// Разбивка списка по датам для «Всех бесед» и «Результатов» (макет Chats): сегодня, вчера,
// на этой неделе (последние семь дней), раньше. Порядок внутри группы — как во входном списке.

export type DateGroup<T> = { label: string; items: T[] }

const LABELS = ['Сегодня', 'Вчера', 'На этой неделе', 'Раньше'] as const

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function dateGroupIndex(date: Date, now: Date): number {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return 0
  if (days === 1) return 1
  if (days < 7) return 2
  return 3
}

export function groupByDate<T>(items: T[], dateOf: (item: T) => Date, now: Date = new Date()): DateGroup<T>[] {
  const buckets: T[][] = LABELS.map(() => [])
  for (const item of items) buckets[dateGroupIndex(dateOf(item), now)].push(item)
  return LABELS.map((label, i) => ({ label, items: buckets[i] })).filter(group => group.items.length > 0)
}
