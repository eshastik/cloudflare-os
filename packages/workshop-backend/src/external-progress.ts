// Промежуточные события хода для внешнего канала (Telegram, ADR 0027 Mnemos).
//
// Поток хода — это событие на каждый кусок текста модели. Слать каждое внешнему получателю — сотни
// вызовов RPC за ход, поэтому здесь события сворачиваются в снимок «что делаю + текст к этому
// моменту» и уходят не чаще раза в PROGRESS_INTERVAL_MS. Пропущенный снимок не повторяется:
// следующий всё равно несёт полное состояние.

import type { AiChatStreamEvent } from "@gadgets/workshop-shared/api";
import type { GadgetProgress } from "@gadgets/workshop-shared/external-message-gateway";

export const PROGRESS_INTERVAL_MS = 700;
const MAX_TEXT = 3500;
const MAX_CODE = 4000;

export type ProgressClock = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const realClock: ProgressClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ExternalProgressRelay {
  #text = "";
  #step: GadgetProgress["step"] = null;
  #toolCallId: string | null = null;
  #timer: unknown = null;
  #dirty = false;
  #inFlight = false;
  #closed = false;
  #lastSent = -Infinity;

  constructor(private send: (progress: GadgetProgress) => Promise<void>, private clock: ProgressClock = realClock) {}

  push(event: AiChatStreamEvent): void {
    if (this.#closed) return;
    switch (event.type) {
      case "textDelta":
        // Хвост текста: черновик в канале показывает, как ответ растёт.
        this.#text = (this.#text + event.delta).slice(-MAX_TEXT);
        this.#step = null;
        break;
      case "toolCallStarted":
        // Новый шаг: текст предыдущего шага модели был пояснением к нему, в черновике он не нужен.
        this.#toolCallId = event.toolCallId;
        this.#step = { toolName: event.toolName };
        this.#text = "";
        break;
      case "toolCodeDelta":
        if (event.toolCallId !== this.#toolCallId || !this.#step) return;
        if ((this.#step.code?.length ?? 0) >= MAX_CODE) return;
        this.#step = { ...this.#step, code: ((this.#step.code ?? "") + event.delta).slice(0, MAX_CODE) };
        break;
      case "compacting":
        this.#step = { toolName: "compacting" };
        break;
      default:
        return;
    }
    this.#schedule();
  }

  close(): void {
    this.#closed = true;
    if (this.#timer !== null) this.clock.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule(): void {
    this.#dirty = true;
    if (this.#timer !== null || this.#inFlight) return;
    let delay = Math.max(0, this.#lastSent + PROGRESS_INTERVAL_MS - this.clock.now());
    this.#timer = this.clock.setTimeout(() => this.#flush(), delay);
  }

  #flush(): void {
    this.#timer = null;
    if (!this.#dirty || this.#closed) return;
    this.#dirty = false;
    this.#inFlight = true;
    this.#lastSent = this.clock.now();
    let snapshot: GadgetProgress = { text: this.#text, step: this.#step };
    Promise.resolve().then(() => this.send(snapshot)).catch(() => {}).finally(() => {
      this.#inFlight = false;
      if (this.#dirty && !this.#closed) this.#schedule();
    });
  }
}
