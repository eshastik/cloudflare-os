const SERVICE_TITLES = new Set(['new chat', 'untitled chat', 'новый чат', 'новая беседа'])

/** Служебные названия бесед из старых версий показываются по-русски; хранимые данные не меняются. */
export function displayChatTitle(title: string | null | undefined): string {
  const value = (title ?? '').trim()
  return !value || SERVICE_TITLES.has(value.toLowerCase()) ? 'Новая беседа' : value
}
