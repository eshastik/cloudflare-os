import { looksLikeId } from '@gadgets/workshop-shared/code-work'
const SERVICE_TITLES = new Set(['new chat', 'untitled chat', 'новый чат', 'новая беседа'])

/** Служебные названия бесед из старых версий показываются по-русски; хранимые данные не меняются. */
export function displayChatTitle(title: string | null | undefined): string {
  const value = (title ?? '').trim()
  return !value || SERVICE_TITLES.has(value.toLowerCase()) || looksLikeId(value) ? 'Новая беседа' : value
}
