// Сервер переносит проекты в граф ядра фоном. Пока перенос не закончен, открытие черновика и пути
// истории проекта отвечают 429 project.history_preparing с progress {done, total}. Это не сбой: история
// появится сама, а документ читается и правится, как позволяет каталог.
//
// Свойства ошибки (code, progress) через RPC до браузера не доходят, доходит только текст. Поэтому ход
// кладётся в конец сообщения меткой «[history_preparing N/M]», а оболочка разбирает её обратно.

import { wordFor } from "./upload-progress.ts";

export const HISTORY_PREPARING = "project.history_preparing";
/** Как часто оболочка спрашивает, готова ли история. */
export const HISTORY_POLL_MS = 12_000;

/** Сколько файлов проекта уже перенесено; total 0 — сервер хода не сообщил. */
export interface HistoryProgress { done: number; total: number }

const LIMIT = 1e9;
const MARK = /\[history_preparing(?: (\d{1,10})\/(\d{1,10}))?\]/;

/** progress из тела ответа сервера; непонятное значение — ход неизвестен, а не ошибка. */
export function historyProgress(value: unknown): HistoryProgress {
  const fields = value && typeof value === "object" ? value as { done?: unknown; total?: unknown } : {};
  const { done, total } = fields;
  if (typeof done !== "number" || typeof total !== "number" || !Number.isSafeInteger(done) || !Number.isSafeInteger(total) ||
      done < 0 || total < 0 || total > LIMIT) return { done: 0, total: 0 };
  return { done: Math.min(done, total), total };
}

/** «История проекта готовится: перенесено 120 из 3 670 файлов». */
export function historyPreparingText(progress: HistoryProgress): string {
  if (!progress.total) return "История проекта готовится";
  const digits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `История проекта готовится: перенесено ${digits(progress.done)} из ${digits(progress.total)} ${wordFor(progress.total, "файла", "файлов", "файлов")}`;
}

/** Текст ошибки, который переживает RPC: подпись для человека и метка хода. */
export function historyPreparingMessage(progress: HistoryProgress): string {
  return `${historyPreparingText(progress)} [history_preparing${progress.total ? ` ${progress.done}/${progress.total}` : ""}]`;
}

/** Ход подготовки истории, если ошибка — «история готовится»; иначе null. */
export function historyPreparing(error: unknown): HistoryProgress | null {
  const failure = error as { code?: unknown; progress?: unknown; message?: unknown } | null;
  if (failure && typeof failure === "object" && failure.code === HISTORY_PREPARING) return historyProgress(failure.progress);
  const match = MARK.exec(typeof failure?.message === "string" ? failure.message : "");
  if (!match) return null;
  return match[1] === undefined ? { done: 0, total: 0 } : historyProgress({ done: Number(match[1]), total: Number(match[2]) });
}

/** Доля перенесённого для полосы, 0–100; null — ход неизвестен. */
export function historyPercent(progress: HistoryProgress): number | null {
  return progress.total ? Math.min(100, Math.floor(progress.done / progress.total * 100)) : null;
}
