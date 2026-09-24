// Загрузка тысяч файлов: пакетами, с ограниченной параллельностью и повтором временных ошибок.
//
// Почему именно так:
// - у сервера предел НЕЗАВЕРШЁННЫХ загрузок одного человека (pgstore.DefaultConcurrentUploads = 32),
//   и билет, чей PUT сорвался, занимает место до уборки. Поэтому параллельно идёт немного файлов
//   (по умолчанию 4), а не «сколько выдержит браузер»;
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
  /** Остановиться после стольких отказов подряд; оставшиеся файлы помечаются незагруженными. */
  stopAfterConsecutiveFailures?: number;
  onProgress?(done: number, total: number): void;
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
export const DEFAULT_CONCURRENCY = 4;

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
        const result = await upload(item, signal);
        done.push({ item, result }); consecutive = 0;
        return;
      } catch (error) {
        signal?.throwIfAborted();
        if (tryNo >= retries || options.permanent?.(error) || stopped) {
          failed.push({ item, error });
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
        if (stopped) failed.push({ item, error: new Error("Загрузка остановлена после серии отказов") });
        else await attempt(item);
        onProgress?.(++finished, items.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
  }
  return { done, failed, stopped };
}

/** Ошибки, повтор которых ничего не изменит: локальные проверки файла и пути. */
export function isPermanentUploadError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? "");
  return /64 МБ|Недопустимое имя|Слишком длинный путь|Некорректная дата|Некорректный файл|не соответствует файлу|Небезопасный адрес|Адрес хранилища не совпадает/.test(message);
}
