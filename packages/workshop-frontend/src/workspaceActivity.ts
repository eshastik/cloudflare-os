import type { AuthenticatedApi } from "@gadgets/workshop-shared/api";

const embeddedInteractions = new Set<() => void>();

/** Accept a diagnostic signal only from the currently focused, visible sandbox frame.
 * Frame reports are untrusted telemetry and never confer identity or permissions.
 */
export function reportEmbeddedWorkspaceActivity(event: MessageEvent, iframe: HTMLIFrameElement | null, visible: boolean): boolean {
  if (!iframe || !visible || !iframe.isConnected || event.source !== iframe.contentWindow || event.origin !== "null" || event.data?.type !== "workspace-activity" || document.activeElement !== iframe || document.visibilityState !== "visible" || !document.hasFocus()) return false;
  for (const notify of embeddedInteractions) notify();
  return true;
}

/** Observe trusted top-level interactions without recording keys, targets, text or URLs.
 * The borrowed API capability belongs to the caller and is not disposed here.
 */
export function observeWorkspaceActivity(api: Pick<AuthenticatedApi, "recordOwnWorkspaceActivity">): () => void {
  const stream = crypto.randomUUID().replaceAll("-", "");
  let sequence = 0, lastInput = -Infinity, busy = false, closed = false;
  let interruption = 0, reportedInterruption = 0;
  const interacted = () => { lastInput = performance.now(); };
  embeddedInteractions.add(interacted);
  const input = (event: Event) => { if (event.isTrusted) interacted(); };
  const sample = async () => {
    if (closed || busy) return;
    busy = true;
    const sampledInterruption = interruption;
    const active = sampledInterruption === reportedInterruption && document.visibilityState === "visible" && document.hasFocus() && performance.now() - lastInput < 60_000;
    try {
      await api.recordOwnWorkspaceActivity(stream, ++sequence, active);
      if (!active) reportedInterruption = sampledInterruption;
    }
    catch { /* Telemetry loss must not interrupt the user's work or invent time. */ }
    finally { busy = false; }
  };
  const changed = () => { if (document.visibilityState !== "visible" || !document.hasFocus()) { lastInput = -Infinity; interruption++; } void sample(); };
  for (const name of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(name, input, { passive: true, capture: true });
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("blur", changed);
  const timer = window.setInterval(() => void sample(), 15_000);
  void sample();
  return () => {
    closed = true;
    embeddedInteractions.delete(interacted);
    window.clearInterval(timer);
    for (const name of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(name, input, true);
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("blur", changed);
  };
}
