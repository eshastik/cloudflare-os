import type { ConsoleLogEvent } from '@gadgets/workshop-shared/api'

// Перезапуск гаджета после «Принять изменения» обрывает вызовы старого экземпляра
// (Overseer.bumpVersion), например leavePresence. Это штатная смена кода, а не ошибка гаджета:
// в консоль браузера она пишется, но в журнал для беседы не попадает.
const GADGET_RESTART_MESSAGE = 'Gadget restarted due to code update.'

export function isGadgetRestartLog(log: ConsoleLogEvent): boolean {
  return log.message.some(part => (typeof part === 'string' ? part : JSON.stringify(part) ?? '').includes(GADGET_RESTART_MESSAGE))
}
