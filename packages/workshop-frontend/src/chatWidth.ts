export const MIN_CHAT_WIDTH = 280
export const MIN_WORKSPACE_WIDTH = 400
export const DEFAULT_CHAT_WIDTH = 440

/** available — место под беседу и документ; без него (вне браузера) ширина прижимается к умолчанию. */
export function clampChatWidth(width: number, available = typeof window !== 'undefined' ? window.innerWidth : undefined) {
  if (available === undefined) return Math.max(MIN_CHAT_WIDTH, Math.min(DEFAULT_CHAT_WIDTH, width))
  const max = Math.max(MIN_CHAT_WIDTH, available - MIN_WORKSPACE_WIDTH)
  return Math.max(MIN_CHAT_WIDTH, Math.min(max, width))
}

/**
 * Ширина беседы при перетаскивании границы. Беседа начинается не от края окна (слева боковое меню и
 * поля), поэтому ширина считается от точки нажатия, а не из clientX: иначе граница прыгает на ширину меню.
 */
export function dragChatWidth(drag: { startX: number; startWidth: number; available: number }, clientX: number) {
  return clampChatWidth(drag.startWidth + (clientX - drag.startX), drag.available)
}
