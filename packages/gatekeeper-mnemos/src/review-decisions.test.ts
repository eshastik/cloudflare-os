import { test } from "node:test";
import assert from "node:assert/strict";
import { validReviewDecisions } from "./review-decisions.ts";

test("history metrics distinguish missing cohorts and constrain the return denominator", () => {
 const none = { samples:0, mean_ms:null, p50_ms:null, p95_ms:null, p99_ms:null };
 const empty = { tracked_candidates:0, historical_candidates:4, responded_candidates:0, returned_candidates:0, fully_approved_candidates:0, first_response:none, full_approval:none };
 assert.equal(validReviewDecisions(empty,4),true);
 const duration={samples:2,mean_ms:20,p50_ms:10,p95_ms:30,p99_ms:30};
 const data={...empty,tracked_candidates:3,historical_candidates:1,responded_candidates:2,returned_candidates:1,fully_approved_candidates:2,first_response:{...duration,samples:3},full_approval:duration};
 assert.equal(validReviewDecisions(data,4),true);
 for(const bad of [null,{}, {...empty,returned_candidates:1}, {...data,tracked_candidates:4}, {...data,responded_candidates:4}, {...data,returned_candidates:3}, {...data,full_approval:{...duration,samples:3}}, {...data,first_response:{...duration,mean_ms:NaN}}, {...data,first_response:{...duration,p95_ms:5}}, {...empty,first_response:{...none,mean_ms:0}}]) assert.equal(validReviewDecisions(bad,4),false);
});
