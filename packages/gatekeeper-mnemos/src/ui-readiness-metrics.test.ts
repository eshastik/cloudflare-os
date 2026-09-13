import test from "node:test";
import assert from "node:assert/strict";
import { validUIReadinessUsage } from "./ui-readiness-metrics.ts";

test("readiness accepts separate surfaces, rejects duplicate groups and unknown surfaces", () => {
  const sample = {surface:"mnemos.management", outcome:"ready", samples:1, p50_ms:10, p95_ms:20, p99_ms:20,last_observed_at:"2026-09-08T09:00:00Z"};
  const rows = ["mnemos.management", "cloudflareos.shell", "cloudflareos.document", "cloudflareos.spreadsheet"].map(surface=>({...sample,surface}));
  assert.equal(validUIReadinessUsage(rows),true);
  assert.equal(validUIReadinessUsage([...rows,rows[2]]),false);
  assert.equal(validUIReadinessUsage([{...sample,surface:"arbitrary.editor"}]),false);
  assert.equal(validUIReadinessUsage([...rows,{...sample,surface:"cloudflareos.document",outcome:"unconfirmed",p50_ms:null,p95_ms:null,p99_ms:null}]),true);
  assert.equal(validUIReadinessUsage([{...sample,outcome:"unconfirmed"}]),false);
});
