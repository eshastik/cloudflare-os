import { collectorClientVersion } from "./uiReadinessVersion";
import type { AuthenticatedApi } from "@gadgets/workshop-shared/api";
import { startUIReadinessAttempt, type UIReadinessSample } from "@gadgets/workshop-shared/ui-readiness";

/** Pin one explicitly selected recipient for the entire load, including its completion. */
export function startWorkspaceUIReadiness(api: Pick<AuthenticatedApi, "getWorkspaceActivityReporting" | "recordOwnUIReadiness">, surface: UIReadinessSample["surface"], supported: Promise<boolean> = Promise.resolve(true)) {
  const recipient = Promise.resolve().then(() => api.getWorkspaceActivityReporting()).then(value => value.selectedAccountId, () => null);
  const remove = () => {
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pagehide", hidden);
  };
  const attempt = startUIReadinessAttempt(surface, async sample => {
    if (sample.outcome !== "pending") remove();
    if (!await supported) return;
    const accountId = await recipient;
    if (accountId !== null) await api.recordOwnUIReadiness(sample, accountId);
  }, () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), undefined, undefined, collectorClientVersion());
  function hidden(event?: Event) { if (event?.type === "pagehide" || document.visibilityState !== "visible") attempt.finish("abandoned"); }
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", hidden);
  hidden();
  return attempt;
}
