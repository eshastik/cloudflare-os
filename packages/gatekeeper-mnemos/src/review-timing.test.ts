import { test } from "node:test";
import assert from "node:assert/strict";
import { validReviewTiming } from "./review-timing.ts";

test("review timing retains unknown cohorts and rejects misleading counts and durations", () => {
 const empty = { completed_samples: 0, mean_completion_ms: null, p50_completion_ms: null, p95_completion_ms: null, p99_completion_ms: null, pending_candidates: 0, oldest_pending_ms: null };
 assert.equal(validReviewTiming(empty, 0, 0), true);
 const ready = { ...empty, completed_samples: 2, mean_completion_ms: 20000, p50_completion_ms: 10000, p95_completion_ms: 30000, p99_completion_ms: 30000, pending_candidates: 1, oldest_pending_ms: 120000 };
 assert.equal(validReviewTiming(ready, 2, 1), true);
 for (const bad of [null, {}, {...empty, mean_completion_ms: 0}, {...empty, oldest_pending_ms: 0}, {...ready, completed_samples: 3}, {...ready, pending_candidates: 2}, {...ready, p95_completion_ms: 9000}, {...ready, mean_completion_ms: Infinity}, {...ready, p99_completion_ms: null}, {...ready, oldest_pending_ms: -1}]) {
  assert.equal(validReviewTiming(bad, 2, 1), false);
 }
 assert.equal(validReviewTiming({...ready, oldest_pending_ms:null}, 2, 1), true);
});
