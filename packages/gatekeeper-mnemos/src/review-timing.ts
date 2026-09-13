/** Calendar durations for confirmed publications and currently pending candidates. */
export interface ReviewTiming {
  completed_samples: number;
  mean_completion_ms: number | null;
  p50_completion_ms: number | null;
  p95_completion_ms: number | null;
  p99_completion_ms: number | null;
  pending_candidates: number;
  oldest_pending_ms: number | null;
}

/** Reject malformed cohorts before presenting them as tenant metrics. */
export function validReviewTiming(value: unknown, published: number, awaiting: number): value is ReviewTiming {
  if (!value || typeof value !== "object") return false;
  const v = value as ReviewTiming;
  if (![v.completed_samples, v.pending_candidates].every(n => Number.isSafeInteger(n) && n >= 0)
      || v.completed_samples > published || v.pending_candidates > awaiting) return false;
  const durations = [v.mean_completion_ms, v.p50_completion_ms, v.p95_completion_ms, v.p99_completion_ms];
  if (v.completed_samples === 0) {
    if (!durations.every(n => n === null)) return false;
  } else {
    if (!durations.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return false;
    if (v.p50_completion_ms! > v.p95_completion_ms! || v.p95_completion_ms! > v.p99_completion_ms!) return false;
  }
  return v.oldest_pending_ms === null || (v.pending_candidates > 0
    && typeof v.oldest_pending_ms === "number" && Number.isFinite(v.oldest_pending_ms) && v.oldest_pending_ms >= 0);
}
