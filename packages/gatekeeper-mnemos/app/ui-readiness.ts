import { startUIReadinessAttempt as startAttempt, readUIReadinessClientVersion, type UIReadinessSample } from "@gadgets/workshop-shared/ui-readiness";

/** Track initial management data through rendering; reporting never blocks the UI. */
export function startUIReadinessAttempt(report: (sample: UIReadinessSample) => Promise<void>, now = () => performance.now(), paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) {
  const policy = typeof document === "undefined" ? undefined : document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content");
  return startAttempt("mnemos.management", report, paint, now, undefined, readUIReadinessClientVersion(policy));
}
