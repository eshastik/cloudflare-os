/** Одна оплаченная операция оболочки для единого учёта расходов Mnemos (POST /v1/spending).
 * Человек и агент определяются в Mnemos по учётным данным запроса, а не по записи. */
export type SpendingEntry = {
  /** Ключ повтора: та же запись, отправленная ещё раз, не удваивает трату. */
  record_id: string;
  occurred_at: string;
  /** chat — беседы; code_agent — агент кода; service — служебное (названия, перевод, маршрутизатор, голос). */
  kind: "chat" | "code_agent" | "service";
  /** Например chat.reply, chat.compaction, chat.title, router, voice.transcribe. */
  operation: string;
  provider: string;
  model: string;
  project_id?: string;
  /** Целые микродоллары строкой, чтобы JavaScript не округлял. */
  micro_usd: string;
  /** Сумма посчитана по каталогу цен, а не взята из ответа поставщика. */
  estimated: boolean;
  input_tokens?: number;
  output_tokens?: number;
};

export const MAX_SPENDING_BATCH = 100;

const OPERATION = /^[a-z0-9_.-]{1,64}$/;

/** Доллары (как их называют поставщики) в целые микродоллары строкой; отрицательное и нечисло — ноль. */
export function usdToMicros(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "0";
  return String(Math.round(usd * 1_000_000));
}

export function isSpendingEntry(v: unknown): v is SpendingEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  const text = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max && !/[\0\r\n]/.test(x);
  const count = (x: unknown) => x === undefined || (Number.isSafeInteger(x) && (x as number) >= 0);
  return text(e.record_id, 255) && typeof e.occurred_at === "string" && !Number.isNaN(Date.parse(e.occurred_at))
    && (e.kind === "chat" || e.kind === "code_agent" || e.kind === "service")
    && typeof e.operation === "string" && OPERATION.test(e.operation) && text(e.provider, 64) && text(e.model, 255)
    && (e.project_id === undefined || text(e.project_id, 255)) && typeof e.micro_usd === "string" && /^\d{1,18}$/.test(e.micro_usd)
    && typeof e.estimated === "boolean" && count(e.input_tokens) && count(e.output_tokens);
}
