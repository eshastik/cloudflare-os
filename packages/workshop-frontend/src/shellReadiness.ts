import { collectorClientVersion } from "./uiReadinessVersion";
import type { AuthenticatedApi } from "@gadgets/workshop-shared/api";
import { startUIReadinessAttempt, type UIReadinessSample } from "@gadgets/workshop-shared/ui-readiness";

type Stage = "config" | "identity" | "features" | "onboarding" | "layout" | "apps" | "workspaces";
type State = "loading" | "ready" | "error";
type Reporter = Pick<AuthenticatedApi, "getWorkspaceActivityReporting" | "recordOwnUIReadiness">;
const painted = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Track the existing bootstrap requests, including pre-JavaScript navigation time. */
export function createShellReadiness(report: (sample: UIReadinessSample) => Promise<void>, now = () => performance.now(), paint = painted) {
  const sessions = new WeakMap<object, Map<Stage, State>>();
  let config: State | undefined;
  let session: object | undefined, path: string | undefined, complete = false, painting = false, revision = 0;
  const attempt = startUIReadinessAttempt("cloudflareos.shell", sample => {
    if (sample.outcome !== "pending") complete = true;
    return report(sample);
  }, paint, now, 0, collectorClientVersion());
  const required = (): Stage[] => path?.startsWith("/workspace/") || path?.startsWith("/gadget/")
    ? ["config", "identity", "features", "onboarding", "layout"]
    : ["config", "identity", "features", "onboarding", "layout", "apps", "workspaces"];
  const current = (key: Stage) => key === "config" ? config : session ? sessions.get(session)?.get(key) : undefined;
  const ready = () => path !== undefined && session !== undefined && required().every(key => current(key) === "ready");
  const check = () => {
    if (complete || !session || path === undefined) return;
    if (required().some(key => current(key) === "error")) { attempt.finish("error"); return; }
    if (painting || !ready()) return;
    painting = true;
    const expected = revision;
    void paint().then(() => {
      painting = false;
      if (complete) return;
      if (expected === revision && ready()) attempt.finish("ready");
      else check();
    }, () => { painting = false; attempt.finish("error"); });
  };
  return {
    stage(key: Stage, state: State, owner?: object) {
      if (complete) return;
      if (key === "config") config = state;
      else {
        if (!owner) return;
        let values = sessions.get(owner);
        if (!values) { values = new Map(); sessions.set(owner, values); }
        values.set(key, state);
      }
      if (key === "config" || owner === session) { revision++; check(); }
    },
    bind(owner: object) { if (session !== owner) { session = owner; revision++; check(); } },
    route(next: string) {
      if (path !== undefined && path !== next) attempt.finish("abandoned");
      path = next; check();
    },
    finish: attempt.finish,
  };
}

let active: ReturnType<typeof createShellReadiness> | undefined;
let bindRecipient: ((api: Reporter) => void) | undefined;
let suppress: (() => void) | undefined;

/** Start once per document; no account, user identity, path or input text is sent in diagnostics. */
export function initializeShellReadiness() {
  if (active) return;
  const queue: UIReadinessSample[] = [];
  let generation = 0, pinned: {api: Reporter; id: number} | undefined, disabled = false;
  const send = (sample: UIReadinessSample) => {
    if (disabled) return;
    if (!pinned) { queue.push(sample); return; }
    try { void pinned.api.recordOwnUIReadiness(sample, pinned.id).catch(() => {}); } catch { /* Reporting does not block startup. */ }
  };
  const hidden = () => { if (document.visibilityState !== "visible") active?.finish("abandoned"); };
  const leave = () => active?.finish("abandoned");
  active = createShellReadiness(async sample => {
    if (sample.outcome !== "pending") {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
    }
    send(sample);
  });
  active.route(location.pathname);
  bindRecipient = api => {
    if (pinned && pinned.api !== api) { active?.finish("abandoned"); return; }
    active?.bind(api);
    if (pinned || disabled) return;
    const expected = ++generation;
    void Promise.resolve().then(() => api.getWorkspaceActivityReporting()).then(config => {
      if (expected !== generation || disabled) return;
      if (config.selectedAccountId === null) { disabled = true; queue.length = 0; return; }
      pinned = {api, id: config.selectedAccountId};
      for (const sample of queue.splice(0)) send(sample);
    }, () => { /* A later valid capability can retry selection; no identity is inferred. */ });
  };
  suppress = () => {
    // Interactive sign-in/onboarding is outside automatic shell restoration. If a start was
    // already delivered, its missing completion remains unconfirmed rather than a false failure.
    disabled = true; queue.length = 0; active?.finish("abandoned");
  };
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", leave);
  hidden();
}

/** Report only actual outcomes of the current session's existing initialization requests. */
export function reportShellStage(stage: Stage, state: State, session?: object) { active?.stage(stage, state, session); }
/** Bind the first usable, explicitly selected diagnostic account; later reports cannot switch recipient. */
export function bindShellReadiness(api: Reporter) { bindRecipient?.(api); }
/** One initial-navigation attempt; in-page navigation cannot manufacture a second successful load. */
export function routeShellReadiness(path: string) { active?.route(path); }
/** Exclude interactive onboarding/sign-in from automatic-restoration latency. */
export function skipShellReadiness() { suppress?.(); }
/** A render failure is a failed shell load, even when the error boundary renders a fallback. */
export function failShellReadiness() { active?.finish("error"); }
