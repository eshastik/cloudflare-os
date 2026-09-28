// Длительность вызовов браузера по WebSocket. На проде страница Mnemos открывалась 8–16 с, а по журналу
// не было видно, какой вызов держит время. Пишется одна строка на вызов дольше порога: имя метода и
// миллисекунды. Аргументы и результат не пишутся — в них бывают ключи сеанса и данные пользователя.

/** Вызовы короче порога в журнал не попадают: их сотни на страницу. */
export const SLOW_RPC_MS = 200;

export type SlowRpcLog = (method: string, ms: number, outcome: "ok" | "error") => void;

/** Оборачивает методы прототипа замером времени. Вызывать после объявления класса (после декораторов). */
export function timeRpcMethods(target: { prototype: object }, api: string, log: SlowRpcLog,
    now: () => number = () => Date.now()): void {
  const proto = target.prototype as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || typeof descriptor.value !== "function") continue;
    const original = descriptor.value as (...args: unknown[]) => unknown;
    const method = `${api}.${name}`;
    const timed = function (this: unknown, ...args: unknown[]): unknown {
      const started = now();
      const done = (outcome: "ok" | "error") => {
        const ms = Math.round(now() - started);
        if (ms >= SLOW_RPC_MS) log(method, ms, outcome);
      };
      let result: unknown;
      try { result = original.apply(this, args); } catch (error) { done("error"); throw error; }
      if (result instanceof Promise) result.then(() => done("ok"), () => done("error"));
      else done("ok");
      return result;
    };
    Object.defineProperty(proto, name, { ...descriptor, value: timed });
  }
}
