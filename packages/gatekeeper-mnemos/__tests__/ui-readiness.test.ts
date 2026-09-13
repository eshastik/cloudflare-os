import { test } from "node:test";
import assert from "node:assert/strict";
import { startUIReadinessAttempt } from "../app/ui-readiness.ts";
import type { UIReadinessSample } from "../src/mnemos-api.ts";

test("readiness waits for rendering and never overwrites an abandoned attempt",async()=>{
 let time=0;let painted=()=>{};
 const samples:UIReadinessSample[]=[];
 const tracker=startUIReadinessAttempt(async s=>{samples.push(s)},()=>time,()=>new Promise<void>(r=>{painted=r}));
 const ready=tracker.afterPaint();time=125;
 assert.deepEqual(samples.map(s=>s.outcome),["pending"]);
 tracker.finish("abandoned");painted();await ready;
 assert.deepEqual(samples.map(s=>s.outcome),["pending","abandoned"]);
 assert.equal(samples[1]!.duration_ms,125);
 assert.equal(samples[0]!.observation_id,samples[1]!.observation_id);
});
test("report failure does not turn a loaded interface into an application error",async()=>{
 let time=10;let calls=0;
 const tracker=startUIReadinessAttempt(async()=>{calls++;throw Error("offline")},()=>time,async()=>{time=85});
 await tracker.afterPaint();tracker.finish("error");
 assert.equal(calls,2);
});
