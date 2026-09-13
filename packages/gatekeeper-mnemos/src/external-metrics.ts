import type { ExternalSnapshot } from "./mnemos-api.ts";

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const timestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** Validate externally collected measurements before passing them to the human UI. */
export function validExternalSnapshot(value: unknown): value is ExternalSnapshot {
  if (!record(value) || !timestamp(value.window_start) || !timestamp(value.observed_at) || Date.parse(value.observed_at) - Date.parse(value.window_start) !== 86400000 || !Array.isArray(value.operations) || value.operations.length !== 4) return false;
  if (!validOperations(value.operations, value.observed_at, true)) return false;
  const versions = value.versions;
  if (versions !== undefined) {
    if (!record(versions) || !count(versions.total_groups) || !Array.isArray(versions.groups) || versions.groups.length !== Math.min(versions.total_groups, 100) || versions.truncated !== (versions.total_groups > 100) || !validOperations(versions.groups, value.observed_at, false)) return false;
    const seen = new Set<string>();
    const label = (v: unknown, max: number) => typeof v === "string" && v.length <= max && (v === "" || /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(v));
    for (const row of versions.groups) {
      if (!record(row) || !label(row.environment, 64) || !label(row.observer_release, 96) || typeof row.observer_version !== "string" || (row.observer_version !== "" && !/^sha256:[0-9a-f]{64}$/.test(row.observer_version)) || row.source_status !== "ready" || !count(row.samples) || row.samples === 0) return false;
      const target = row.target_deployment;
      if (target != null && (!record(target) || row.operation !== "readiness")) return false;
      const contextKey = target == null ? null : [target.environment,target.release,target.source_revision,target.source_modified,target.go_version,target.schema_version];
      const key = JSON.stringify([row.environment, row.observer_release, row.observer_version, row.operation, contextKey]);
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  return true;
}

function validOperations(operations: unknown[], observedAt: string, unique: boolean): boolean {
  const seen = new Set<string>();
  for (const op of operations) {
    if (!record(op) || typeof op.operation !== "string" || !["readiness", "login", "read", "save"].includes(op.operation) || (unique && seen.has(op.operation)) || typeof op.source_status !== "string" || !["ready", "unavailable", "invalid", "too_large"].includes(op.source_status) || !count(op.samples) || !count(op.successes) || op.successes > op.samples || typeof op.stale !== "boolean") return false;
    seen.add(op.operation);
    if (op.samples === 0 ? op.mean_duration_ms !== null : typeof op.mean_duration_ms !== "number" || !Number.isFinite(op.mean_duration_ms) || op.mean_duration_ms < 0) return false;
    const latency = op.duration_percentiles_ms;
    if (latency != null && (!record(latency) || op.samples === 0 || ![latency.p50, latency.p95, latency.p99].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0) || Number(latency.p50)>Number(latency.p95) || Number(latency.p95)>Number(latency.p99))) return false;
    if (op.last_observed_at === null) {
      if (op.last_success !== null || op.last_outcome !== null || !op.stale || op.samples !== 0) return false;
    } else {
      if (!timestamp(op.last_observed_at) || Date.parse(op.last_observed_at) > Date.parse(observedAt) || typeof op.last_success !== "boolean" || typeof op.last_outcome !== "string") return false;
      const success = op.last_outcome === (op.operation === "readiness" ? "ready" : "ok");
      if (op.last_success !== success || (!success && !["not_ready", "http_error", "invalid_response", "network_error", "timeout", "tls_error"].includes(op.last_outcome))) return false;
      if (op.stale !== (Date.parse(observedAt) - Date.parse(op.last_observed_at) > 180000)) return false;
    }
    if (op.source_status !== "ready" && (op.samples !== 0 || op.last_observed_at !== null)) return false;
  }
  return true;
}
