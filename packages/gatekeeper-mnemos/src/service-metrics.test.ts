import assert from "node:assert/strict";
import test from "node:test";
import { validServiceSnapshot } from "./service-metrics.ts";

test("service measurements reject broken totals, buckets and periods", () => {
  const sample = () => ({ started_at: "2026-09-08T08:00:00Z", observed_at: "2026-09-08T09:00:00Z", operations: [{ surface: "http", method: "/read", requests: 2, duration_seconds: 20.001, outcomes: { ok: 1, denied: 1 }, buckets: [{ upper_seconds: .001 as number | null, count: 1 }, { upper_seconds: 10 as number | null, count: 1 }, { upper_seconds: null as number | null, count: 2 }] }] });
  assert.equal(validServiceSnapshot(sample()), true);
  for (const mutate of [
    (s: ReturnType<typeof sample>) => { s.operations[0].outcomes.ok = 2; },
    (s: ReturnType<typeof sample>) => { s.operations[0].buckets[1].count = 0; },
    (s: ReturnType<typeof sample>) => { s.operations[0].buckets[2].count = 1; },
    (s: ReturnType<typeof sample>) => { s.operations[0].buckets[1].upper_seconds = .0001; },
    (s: ReturnType<typeof sample>) => { s.operations[0].duration_seconds = NaN; },
    (s: ReturnType<typeof sample>) => { s.observed_at = "2026-09-07T08:00:00Z"; },
    (s: ReturnType<typeof sample>) => { s.operations.push(s.operations[0]); },
  ]) {
    const s = sample(); mutate(s); assert.equal(validServiceSnapshot(s), false);
  }
  assert.equal(validServiceSnapshot({ ...sample(), operations: [] }), true);
  assert.equal(validServiceSnapshot(null), false);
});
