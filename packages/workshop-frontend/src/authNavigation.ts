// Выход должен завершить сессию даже при открытом несохранённом документе.
export const LOGOUT_EVENT = 'mnemos-session-logout'
export function prepareForLogout(): void {
  window.dispatchEvent(new Event(LOGOUT_EVENT))
}
