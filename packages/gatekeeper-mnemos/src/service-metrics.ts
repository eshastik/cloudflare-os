import type { ServiceSnapshot } from "./mnemos-api.ts";

const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reject inconsistent measurements rather than display plausible partial totals. */
export function validServiceSnapshot(value: unknown): value is ServiceSnapshot {
  if (!record(value) || typeof value.started_at !== "string" || typeof value.observed_at !== "string") return false;
  const start = Date.parse(value.started_at), end = Date.parse(value.observed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !Array.isArray(value.operations)) return false;
  const seen = new Set<string>();
  for (const op of value.operations) {
    if (!record(op) || typeof op.surface !== "string" || typeof op.method !== "string" || !count(op.requests) || op.requests === 0 || typeof op.duration_seconds !== "number" || !Number.isFinite(op.duration_seconds) || op.duration_seconds < 0 || !record(op.outcomes) || !Array.isArray(op.buckets) || op.buckets.length < 2) return false;
    const key = JSON.stringify([op.surface, op.method]);
    if (seen.has(key)) return false;
    seen.add(key);
    const outcomes = Object.values(op.outcomes);
    if (!outcomes.every(count) || outcomes.reduce((sum, n) => sum + n, 0) !== op.requests) return false;
    let previousCount = 0, previousBound = -1;
    for (let i = 0; i < op.buckets.length; i++) {
      const bucket = op.buckets[i];
      if (!record(bucket) || !count(bucket.count) || bucket.count < previousCount || bucket.count > op.requests) return false;
      if (i === op.buckets.length - 1) {
        if (bucket.upper_seconds !== null || bucket.count !== op.requests) return false;
      } else {
        if (typeof bucket.upper_seconds !== "number" || !Number.isFinite(bucket.upper_seconds) || bucket.upper_seconds < 0 || bucket.upper_seconds <= previousBound) return false;
        previousBound = bucket.upper_seconds;
      }
      previousCount = bucket.count;
    }
  }
  return true;
}
