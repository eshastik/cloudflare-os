// Страховка от бесконечных повторов упавшего вызова: модель, получив ошибку инструмента, часто
// повторяет тот же вызов с теми же аргументами. После LIMIT одинаковых ошибок подряд повтор не
// выполняется, модель получает объяснение и указание честно сообщить человеку о неудаче.

export const REPEATED_FAILURE_LIMIT = 2;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  let entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

function shortError(error: string): string {
  let line = error.replace(/\s+/g, " ").trim();
  return line.length > 300 ? line.slice(0, 299) + "…" : line;
}

/** Считает одинаковые ошибки одного и того же вызова (инструмент + аргументы) подряд. */
export class RepeatedFailureGuard {
  #failures = new Map<string, {error: string; count: number}>();
  #refusals = 0;

  constructor(readonly limit = REPEATED_FAILURE_LIMIT) {}

  /** Сколько раз за ход повтор был отклонён без выполнения. */
  get refusals(): number { return this.#refusals; }

  #key(tool: string, args: unknown): string { return `${tool}:${stableJson(args)}`; }

  /** Перед выполнением: текст отказа, если этот вызов уже упал LIMIT раз подряд одинаково. */
  before(tool: string, args: unknown): string | null {
    let failure = this.#failures.get(this.#key(tool, args));
    if (!failure || failure.count < this.limit) return null;
    this.#refusals++;
    return `Повтор не выполнен: этот же вызов уже ${failure.count} раза подряд завершился ошибкой «${shortError(failure.error)}». ` +
      "Не повторяй его. Честно скажи человеку, что не получилось и почему (своими словами по тексту ошибки), " +
      "и что он может сделать. Не выдавай общие знания за результат проверки.";
  }

  /** Вызов выполнился: счётчик этого вызова сбрасывается. */
  succeeded(tool: string, args: unknown): void {
    this.#failures.delete(this.#key(tool, args));
  }

  /** Вызов упал; возвращает приписку к ошибке, когда достигнут предел одинаковых ошибок. */
  failed(tool: string, args: unknown, error: string): string | null {
    let key = this.#key(tool, args);
    let previous = this.#failures.get(key);
    let count = previous && previous.error === error ? previous.count + 1 : 1;
    this.#failures.set(key, {error, count});
    if (count < this.limit) return null;
    return `Этот вызов ${count} раза подряд завершился одной и той же ошибкой. Не повторяй его: ` +
      "сообщи человеку, что не получилось и почему, и что он может сделать.";
  }
}

type ExecutableTool = {name: string; execute: (...args: any[]) => Promise<unknown>};

/** Оборачивает execute инструментов проверкой повторов; остальные поля инструмента не меняются. */
export function guardToolRepeats<T extends ExecutableTool>(tools: T[], guard: RepeatedFailureGuard,
    errorText: (error: unknown) => string,
    /** Сообщает итоговый текст ошибки, чтобы сохранённая запись совпала с тем, что видела модель. */
    onErrorText?: (toolCallId: string, text: string) => void): T[] {
  return tools.map(tool => {
    let execute = tool.execute;
    return {
      ...tool,
      execute: async (toolCallId: string, params: unknown, ...rest: unknown[]) => {
        let refusal = guard.before(tool.name, params);
        if (refusal) { onErrorText?.(toolCallId, refusal); throw new Error(refusal); }
        try {
          let result = await execute.call(tool, toolCallId, params, ...rest);
          guard.succeeded(tool.name, params);
          return result;
        } catch (error) {
          let note = guard.failed(tool.name, params, errorText(error));
          if (note && error instanceof Error) {
            error.message = `${error.message}\n\n${note}`;
            onErrorText?.(toolCallId, error.message);
          }
          throw error;
        }
      },
    };
  });
}
