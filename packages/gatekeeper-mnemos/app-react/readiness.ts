import { startUIReadinessAttempt } from "../app/ui-readiness.ts";

type Attempt = ReturnType<typeof startUIReadinessAttempt>;
/** Замер готовности интерфейса: от запуска фрейма до первой отрисовки данных. Отчёт никогда не блокирует экран. */
let attempt: Attempt | null = null;
/** Оболочке уже сказано, что первые данные на экране. */
let contentAnnounced = false;

export function startReadiness(report: Parameters<typeof startUIReadinessAttempt>[0]): void {
  attempt = startUIReadinessAttempt(report);
  window.addEventListener("visibilitychange", () => { if (document.hidden) finish("abandoned"); });
  window.addEventListener("pagehide", () => finish("abandoned"), { once: true });
}
function finish(outcome: "abandoned" | "error"): void { const current = attempt; attempt = null; current?.finish(outcome); }

/** Оболочка держит индикатор загрузки раздела до этого сообщения (рукопожатие обещает его полем
 * contentReady). Шлётся один раз, после отрисовки: иначе индикатор снялся бы над пустым экраном. */
export function announceContentReady(): void {
  if (contentAnnounced) return;
  contentAnnounced = true;
  const post = () => window.parent.postMessage({ type: "gatekeeper-content-ready" }, "*");
  if (typeof requestAnimationFrame !== "function") { post(); return; }
  requestAnimationFrame(() => setTimeout(post, 0));
}

/** Первые данные получены и показаны. */
export function readinessReady(): void {
  announceContentReady();
  const current = attempt; attempt = null;
  if (!current) return;
  if (document.hidden) current.finish("abandoned"); else void current.afterPaint();
}
/** Первые данные не получены: экран показывает ошибку, индикатор оболочки больше не нужен. */
export function readinessFailed(): void { announceContentReady(); finish("error"); }
