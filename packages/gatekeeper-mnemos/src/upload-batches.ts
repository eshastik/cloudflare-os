// Загрузка тысяч файлов: пакетами, с ограниченной параллельностью и повтором временных ошибок.
//
// Почему именно так:
// - у сервера предел НЕЗАВЕРШЁННЫХ загрузок одного человека (pgstore.DefaultConcurrentUploads = 32),
//   и билет, чей PUT сорвался, занимает место до уборки. Поэтому параллельно идёт немного файлов
//   (по умолчанию 6), а не «сколько выдержит браузер». 6 в полёте плюс 25 отказов подряд до
//   остановки (каждый может оставить занятый билет) — 31, меньше предела 32. Каждый файл в полёте
//   целиком читается в память ради контрольной суммы (до 64 МБ), это второй довод не поднимать выше;
// - у сервера же предел запросов в минуту на человека (quota.DefaultRequestsPerMinute), а каждый
//   файл — два запроса (билет и приём). Пакеты дают точку, где загрузку можно остановить, и
//   ограничивают объём файлов, одновременно прочитанных в память для контрольной суммы;
// - если подряд не проходит много файлов, дальше не пробуем: это отказ установки, а не сбой сети,
//   и тысячи повторов лишь займут предел запросов.

export interface BatchUploadOptions<T, R> {
  items: readonly T[];
  upload(item: T, signal?: AbortSignal): Promise<R>;
  signal?: AbortSignal;
  batchSize?: number;
  concurrency?: number;
  /** Сколько раз повторить временную ошибку (первая попытка не считается). */
  retries?: number;
  /** Ошибка, которую бесполезно повторять (файл слишком большой, недопустимое имя). */
  permanent?(error: unknown): boolean;
  /**
   * Файл не принят по правилу установки (секреты, сторонний код). Это решение о файле, а не сбой:
   * не повторяется и не входит в серию отказов подряд — папка vendor из сотен файлов не должна
   * останавливать загрузку остальных.
   */
  refused?(error: unknown): boolean;
  /** Остановиться после стольких отказов подряд; оставшиеся файлы помечаются незагруженными. */
  stopAfterConsecutiveFailures?: number;
  onProgress?(done: number, total: number): void;
  /** Файл пошёл в загрузку (каждая попытка). */
  onStart?(item: T): void;
  /** Файл обработан окончательно: принят (error не задан) или не принят после повторов. */
  onSettled?(item: T, error?: unknown): void;
  /** Пауза перед повтором; в тестах подменяется мгновенной. */
  wait?(ms: number, signal?: AbortSignal): Promise<void>;
  backoffMs?: readonly number[];
}

export interface BatchUploadResult<T, R> {
  done: { item: T; result: R }[];
  failed: { item: T; error: unknown }[];
  /** Загрузка остановлена после серии отказов; часть файлов не пробовали. */
  stopped: boolean;
}

export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_CONCURRENCY = 6;

/** Делит список на пакеты по size элементов, сохраняя порядок. */
export function splitIntoBatches<T>(items: readonly T[], size = DEFAULT_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("Размер пакета должен быть положительным целым");
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal!.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function uploadInBatches<T, R>(options: BatchUploadOptions<T, R>): Promise<BatchUploadResult<T, R>> {
  const { items, upload, signal, onProgress } = options;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const retries = Math.max(0, options.retries ?? 2);
  const backoff = options.backoffMs ?? [1000, 4000, 10000];
  const wait = options.wait ?? defaultWait;
  const stopAfter = options.stopAfterConsecutiveFailures ?? 25;
  const done: BatchUploadResult<T, R>["done"] = [], failed: BatchUploadResult<T, R>["failed"] = [];
  let finished = 0, consecutive = 0, stopped = false;

  async function attempt(item: T): Promise<void> {
    for (let tryNo = 0; ; tryNo++) {
      signal?.throwIfAborted();
      try {
        options.onStart?.(item);
        const result = await upload(item, signal);
        done.push({ item, result }); consecutive = 0;
        options.onSettled?.(item);
        return;
      } catch (error) {
        signal?.throwIfAborted();
        if (options.refused?.(error)) {
          failed.push({ item, error });
          options.onSettled?.(item, error);
          return;
        }
        if (tryNo >= retries || options.permanent?.(error) || stopped) {
          failed.push({ item, error });
          options.onSettled?.(item, error);
          if (++consecutive >= stopAfter) stopped = true;
          return;
        }
        await wait(backoff[Math.min(tryNo, backoff.length - 1)] ?? 1000, signal);
      }
    }
  }

  for (const batch of splitIntoBatches(items, options.batchSize ?? DEFAULT_BATCH_SIZE)) {
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        const item = batch[next++];
        if (stopped) { const error = new Error("Загрузка остановлена после серии отказов"); failed.push({ item, error }); options.onSettled?.(item, error); }
        else await attempt(item);
        onProgress?.(++finished, items.length);
      }
    };
    // При отмене ждём, пока закончатся уже начатые файлы: приём, подтверждённый сервером в момент
    // остановки, должен попасть в итог, а не пропасть из него.
    const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
    const rejected = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (rejected) throw rejected.reason;
  }
  return { done, failed, stopped };
}

/** Отказ приёмной политики, пересёкший RPC: только имя и текст ошибки доходят до браузера. */
const REFUSAL_PREFIX = "Не принят приёмной политикой";
const REFUSAL = /^Не принят приёмной политикой \[([a-z_]*)\]: ([\s\S]*)$/;
/** Ответ сервера с кодом состояния: «… (HTTP 400)». */
const HTTP_STATUS = /\(HTTP (\d{3})\)$/;

export interface UploadRefusal { reason: string; detail: string }

/**
 * Ошибка приёма для передачи через RPC. Свойства ошибки (status, code) по дороге теряются, поэтому
 * всё нужное браузеру кладётся в текст: отказ политики — с причиной и абзацем сервера, прочие ответы
 * сервера — с кодом состояния.
 */
export function uploadFailure(error: unknown): unknown {
  const failure = error as { message?: unknown; status?: unknown; code?: unknown; refusal?: { reason?: unknown; detail?: unknown } } | null;
  if (!failure || typeof failure !== "object" || typeof failure.status !== "number") return error;
  if (failure.code === "ingest.refused_by_policy") {
    const reason = typeof failure.refusal?.reason === "string" ? failure.refusal.reason : "";
    const detail = typeof failure.refusal?.detail === "string" ? failure.refusal.detail : "";
    return new Error(`${REFUSAL_PREFIX} [${reason}]: ${detail}`);
  }
  return new Error(`${String(failure.message ?? "Mnemos request failed")} (HTTP ${failure.status})`);
}

/** Причина отказа политики или undefined, если это не отказ. */
export function uploadRefusal(error: unknown): UploadRefusal | undefined {
  const match = REFUSAL.exec(String((error as Error)?.message ?? ""));
  return match ? { reason: match[1], detail: match[2].trim() } : undefined;
}

export function isRefusedUpload(error: unknown): boolean {
  return uploadRefusal(error) !== undefined;
}

/** Ошибки, повтор которых ничего не изменит: локальные проверки файла и пути, отказы сервера 4xx. */
export function isPermanentUploadError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? "");
  if (isRefusedUpload(error)) return true;
  const status = HTTP_STATUS.exec(message);
  // 408, 409, 425 и 429 — «не сейчас», а не «никогда»: их стоит повторить после паузы.
  if (status) { const code = Number(status[1]); return code >= 400 && code < 500 && ![408, 409, 425, 429].includes(code); }
  return /64 МБ|Недопустимое имя|Слишком длинный путь|Некорректная дата|Некорректный файл|не соответствует файлу|Небезопасный адрес|Адрес хранилища не совпадает/.test(message);
}

/**
 * Повтор операции, которую сервер отложил ответом 429 project.upload_in_progress: история проекта
 * не открывается, пока в него загружаются файлы. Паузы растут; после последней ошибка уходит
 * вызывающему с понятным текстом.
 */
export async function retryWhileUploading<T>(run: () => Promise<T>, options: { pausesMs?: readonly number[]; wait?(ms: number, signal?: AbortSignal): Promise<void>; signal?: AbortSignal } = {}): Promise<T> {
  const pauses = options.pausesMs ?? [2000, 5000, 10000];
  const wait = options.wait ?? defaultWait;
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "project.upload_in_progress" || attempt >= pauses.length) throw error;
      await wait(pauses[attempt], options.signal);
    }
  }
}
