/** Exact calendar duration cohort, with null statistics when unobserved. */
export interface ReviewDuration {
  samples: number;
  mean_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

/** Complete decision trails only; first responses count assigned reviewer/domain pairs. */
export interface ReviewDecisions {
  tracked_candidates: number;
  historical_candidates: number;
  responded_candidates: number;
  returned_candidates: number;
  fully_approved_candidates: number;
  first_response: ReviewDuration;
  full_approval: ReviewDuration;
}

function validDuration(value: unknown): value is ReviewDuration {
  if (!value || typeof value !== "object") return false;
  const v = value as ReviewDuration;
  if (!Number.isSafeInteger(v.samples) || v.samples < 0) return false;
  const durations = [v.mean_ms, v.p50_ms, v.p95_ms, v.p99_ms];
  if (v.samples === 0) return durations.every(n => n === null);
  return durations.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)
    && v.p50_ms! <= v.p95_ms! && v.p95_ms! <= v.p99_ms!;
}

/** Validate cohort relationships without assuming absent history means no returns. */
export function validReviewDecisions(value: unknown, submitted: number): value is ReviewDecisions {
  if (!value || typeof value !== "object") return false;
  const v = value as ReviewDecisions;
  if (![v.tracked_candidates, v.historical_candidates, v.responded_candidates, v.returned_candidates, v.fully_approved_candidates].every(n => Number.isSafeInteger(n) && n >= 0)) return false;
  if (v.tracked_candidates + v.historical_candidates !== submitted
      || v.responded_candidates > v.tracked_candidates || v.returned_candidates > v.responded_candidates
      || v.fully_approved_candidates > v.responded_candidates) return false;
  return validDuration(v.first_response) && validDuration(v.full_approval)
    && v.full_approval.samples <= v.fully_approved_candidates
    && (v.responded_candidates > 0 || v.first_response.samples === 0);
}
