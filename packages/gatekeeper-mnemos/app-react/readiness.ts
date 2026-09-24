import { startUIReadinessAttempt } from "../app/ui-readiness.ts";

type Attempt = ReturnType<typeof startUIReadinessAttempt>;
/** Замер готовности интерфейса: от запуска фрейма до первой отрисовки данных. Отчёт никогда не блокирует экран. */
let attempt: Attempt | null = null;

export function startReadiness(report: Parameters<typeof startUIReadinessAttempt>[0]): void {
  attempt = startUIReadinessAttempt(report);
  window.addEventListener("visibilitychange", () => { if (document.hidden) finish("abandoned"); });
  window.addEventListener("pagehide", () => finish("abandoned"), { once: true });
}
function finish(outcome: "abandoned" | "error"): void { const current = attempt; attempt = null; current?.finish(outcome); }
/** Первые данные получены и показаны. */
export function readinessReady(): void {
  const current = attempt; attempt = null;
  if (!current) return;
  if (document.hidden) current.finish("abandoned"); else void current.afterPaint();
}
export function readinessFailed(): void { finish("error"); }
