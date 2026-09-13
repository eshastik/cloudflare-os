/** Bounded diagnostic surfaces; never identity or authorization inputs. */
export const UI_READINESS_SURFACES = ["mnemos.management", "cloudflareos.shell", "cloudflareos.document", "cloudflareos.spreadsheet", "cloudflareos.presentation"] as const;

/** One browser load attempt, with a stable identifier and a first terminal outcome. */
export interface UIReadinessSample {
  /** Build fingerprint of the first-party collector; absent for unidentified development builds. */
  client_version?: string;
  /** Random diagnostic identifier, independent of any document identifier. */
  observation_id: string;
  /** Host-selected interface category. */
  surface: typeof UI_READINESS_SURFACES[number];
  /** Missing completion remains pending; it never implies success. */
  outcome: "pending" | "ready" | "error" | "timeout" | "abandoned";
  /** Monotonic elapsed milliseconds, null while pending. */
  duration_ms: number | null;
}

/** Reject unbounded diagnostics and extra fields before forwarding to a connector. */
export function isUIReadinessSample(value: unknown): value is UIReadinessSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sample = value as Record<string, unknown>;
  return (Object.keys(sample).length === 4 || Object.keys(sample).length === 5) && Object.keys(sample).every(key => ["observation_id", "surface", "outcome", "duration_ms", "client_version"].includes(key))
    && (sample.client_version === undefined || sample.client_version === "" || (typeof sample.client_version === "string" && /^(sha256:[a-f0-9]{64}|asset:[A-Za-z0-9._-]{1,96})$/.test(sample.client_version))) && typeof sample.observation_id === "string" && /^[a-f0-9]{32}$/.test(sample.observation_id)
    && UI_READINESS_SURFACES.some(surface => surface === sample.surface)
    && typeof sample.outcome === "string" && ["pending", "ready", "error", "timeout", "abandoned"].includes(sample.outcome)
    && (sample.outcome === "pending" ? sample.duration_ms === null : Number.isSafeInteger(sample.duration_ms) && Number(sample.duration_ms) >= 0 && Number(sample.duration_ms) <= 600000);
}

/** Identify the collector from its CSP-pinned script or compiled frontend entry asset.
 * This is not the version of user-editable native code. Development URLs remain unknown. */
export function readUIReadinessClientVersion(policy?: string | null, entryPaths: readonly string[] = []): string | undefined {
  const hash = policy?.match(/'sha256-([A-Za-z0-9+/]{43}=)'/);
  if (hash) {
    const bytes = atob(hash[1]);
    if (bytes.length === 32) return "sha256:" + Array.from(bytes, c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  }
  for (const path of entryPaths) {
    const asset = path.match(/^\/assets\/(index-[A-Za-z0-9_-]+\.js)$/)?.[1];
    if (asset && asset.length <= 96) return "asset:" + asset;
  }
  return undefined;
}

/** Measure one load; startedAt may be navigation start in the same monotonic clock. First terminal result wins. */
export function startUIReadinessAttempt(surface: UIReadinessSample["surface"], report: (sample: UIReadinessSample) => Promise<void>, paint: () => Promise<void>, now = () => performance.now(), startedAt = now(), clientVersion?: string) {
  const observationId = crypto.randomUUID().replaceAll("-", "");
  const started = startedAt;
  let terminal = false;
  const emit = (sample: UIReadinessSample) => { try { void report(clientVersion ? { ...sample, client_version: clientVersion } : sample).catch(() => {}); } catch { /* Missing delivery is not success. */ } };
  emit({ observation_id: observationId, surface, outcome: "pending", duration_ms: null });
  const timer = setTimeout(() => finish("timeout"), Math.max(0, 120000 - (now() - started)));
  function finish(outcome: Exclude<UIReadinessSample["outcome"], "pending">) {
    if (terminal) return;
    terminal = true;
    clearTimeout(timer);
    emit({ observation_id: observationId, surface, outcome, duration_ms: Math.round(now() - started) });
  }
  return { observationId, finish, async afterPaint() { await paint(); finish("ready"); } };
}
