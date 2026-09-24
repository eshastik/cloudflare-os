// Инициалы человека для круглого аватара без фотографии: «Александр Егоров» → «АЕ».
export function personInitials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map(part => part[0]!.toUpperCase()).join('') || '?'
}
