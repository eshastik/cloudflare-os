/** Причина сбоя гаджета без произвольного текста ошибки, который может содержать исходник. */
export function gadgetFailureReason(error: unknown, fallback: string): string {
  let record = error && typeof error === "object" ? error as {code?: unknown; message?: unknown} : {};
  let code = typeof record.code === "string" ? record.code : "";
  let message = typeof error === "string" ? error : typeof record.message === "string" ? record.message : "";
  if (/ModelNotFoundError|model not found/i.test(message)) return "Модель для задачи недоступна.";
  switch (message.trim()) {
    case "модель OpenCode не найдена": return "Модель для задачи недоступна.";
    case "провайдер модели отклонил ключ доступа": return "Провайдер модели отклонил ключ доступа.";
    case "задача превысила контекст модели": return "Задача превысила контекст модели.";
    case "ответ модели превысил допустимую длину": return "Ответ модели превысил допустимую длину.";
    case "OpenCode завершил задачу с ошибкой": return "OpenCode завершил задачу с ошибкой.";
    case "рабочее место не запустилось": return "Не удалось запустить рабочее место.";
    case "OpenCode не ответил": return "OpenCode не ответил.";
    case "сессия OpenCode не создана": return "Не удалось создать сессию OpenCode.";
    case "задача не передана агенту": return "Не удалось передать задачу агенту.";
    case "истёк срок задачи": return "Истёк срок задачи.";
  }
  const status = /^провайдер модели вернул HTTP ([45]\d\d)$/.exec(message.trim());
  if (status) return `Провайдер модели вернул HTTP ${status[1]}.`;
  const stageStatus = /^(OpenCode не ответил|сессия OpenCode не создана|задача не передана агенту): HTTP ([45]\d\d)$/.exec(message.trim());
  if (stageStatus) {
    const title = stageStatus[1] === "сессия OpenCode не создана" ? "Не удалось создать сессию OpenCode"
      : stageStatus[1] === "задача не передана агенту" ? "Не удалось передать задачу агенту" : "OpenCode не ответил";
    return `${title}: HTTP ${stageStatus[2]}.`;
  }
  switch (code) {
    case "scope": return "Нет права на работу с гаджетом в этом проекте.";
    case "no_build": return "Задача не подготовила сборку гаджета.";
    case "bad_build": return "Сборка гаджета не прошла проверку формата.";
    case "stopped": return "Задача гаджета остановлена.";
    case "not_ready": return "Рабочее место ещё не готово.";
    case "unavailable": return "Служба рабочих мест недоступна.";
    default: return fallback;
  }
}
