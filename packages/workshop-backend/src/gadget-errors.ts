/** Причина сбоя гаджета без произвольного текста ошибки, который может содержать исходник. */
export function gadgetFailureReason(error: unknown, fallback: string): string {
  let record = error && typeof error === "object" ? error as {code?: unknown; message?: unknown} : {};
  let code = typeof record.code === "string" ? record.code : "";
  let message = typeof error === "string" ? error : typeof record.message === "string" ? record.message : "";
  if (/ModelNotFoundError|model not found/i.test(message)) return "Модель для задачи недоступна.";
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
