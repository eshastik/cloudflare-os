import { test } from "node:test";
import assert from "node:assert/strict";
import { validExternalSnapshot } from "./external-metrics.ts";

test("external metrics preserve unknown, stale failures and reject invented successes", () => {
  const fixture = { window_start:"2026-09-07T12:00:00Z", observed_at:"2026-09-08T12:00:00Z", operations:["readiness","login","read","save"].map(operation=>({operation,source_status:"ready",samples:1,successes:0,last_observed_at:"2026-09-08T11:55:00Z",last_success:false,last_outcome:"timeout",stale:true,mean_duration_ms:5000})) };
  assert.equal(validExternalSnapshot(fixture),true);
  for (const patch of [{successes:2},{last_success:true},{stale:false},{mean_duration_ms:null},{source_status:"unavailable"}]) {
    const changed=structuredClone(fixture);Object.assign(changed.operations[2]!,patch);
    assert.equal(validExternalSnapshot(changed),false);
  }
  const missing=structuredClone(fixture);
  Object.assign(missing.operations[3]!,{source_status:"unavailable",samples:0,successes:0,last_observed_at:null,last_success:null,last_outcome:null,stale:true,mean_duration_ms:null});
  assert.equal(validExternalSnapshot(missing),true);
});

test("external duration percentiles are ordered and absent without attempts",()=>{
 const fixture = { window_start:"2026-09-07T12:00:00Z", observed_at:"2026-09-08T12:00:00Z", operations:["readiness","login","read","save"].map(operation=>({operation,source_status:"ready",samples:1,successes:0,last_observed_at:"2026-09-08T11:55:00Z",last_success:false,last_outcome:"timeout",stale:true,mean_duration_ms:5000,duration_percentiles_ms:{p50:5000,p95:5000,p99:5000}})) };
 assert.equal(validExternalSnapshot(fixture),true);
 const bad=structuredClone(fixture);bad.operations[2]!.duration_percentiles_ms.p50=6000;
 assert.equal(validExternalSnapshot(bad),false);
 const empty=structuredClone(fixture);Object.assign(empty.operations[3]!,{samples:0,mean_duration_ms:null,last_observed_at:null,last_success:null,last_outcome:null});
 assert.equal(validExternalSnapshot(empty),false);
});

test("observer version groups retain unknown labels and reject duplicates and hidden truncation",()=>{
 const op={operation:"read",source_status:"ready",samples:1,successes:1,last_observed_at:"2026-09-08T12:00:00Z",last_success:true,last_outcome:"ok",stale:false,mean_duration_ms:10};
 const row={...op,environment:"",observer_release:"",observer_version:""};
 const fixture={window_start:"2026-09-07T12:00:00Z",observed_at:"2026-09-08T12:00:00Z",operations:["readiness","login","read","save"].map(operation=>({...op,operation,last_outcome:operation==="readiness"?"ready":"ok"})),versions:{groups:[row],total_groups:1,truncated:false}};
 assert.equal(validExternalSnapshot(fixture),true);
 for(const patch of [{observer_version:"https://invalid.test"},{environment:"a".repeat(65)},{observer_release:"has spaces"}]) { const bad=structuredClone(fixture);Object.assign(bad.versions.groups[0]!,patch);assert.equal(validExternalSnapshot(bad),false); }
 const duplicate=structuredClone(fixture);duplicate.versions.groups.push(row);duplicate.versions.total_groups=2;assert.equal(validExternalSnapshot(duplicate),false);
 const capped=structuredClone(fixture);capped.versions.groups=Array.from({length:100},(_,i)=>({...row,environment:`env${i}`}));capped.versions.total_groups=101;capped.versions.truncated=true;assert.equal(validExternalSnapshot(capped),true);capped.versions.truncated=false;assert.equal(validExternalSnapshot(capped),false);
});

test("target deployments split readiness groups without splitting equivalent property order",()=>{
 const op={operation:"readiness",source_status:"ready",samples:1,successes:1,last_observed_at:"2026-09-08T12:00:00Z",last_success:true,last_outcome:"ready",stale:false,mean_duration_ms:10};
 const a={environment:"local",release:"a",source_revision:"",source_modified:null,go_version:"",schema_version:112};
 const row={...op,environment:"local",observer_release:"",observer_version:"",target_deployment:a};
 const fixture={window_start:"2026-09-07T12:00:00Z",observed_at:"2026-09-08T12:00:00Z",operations:["readiness","login","read","save"].map(operation=>({...op,operation,last_outcome:operation==="readiness"?"ready":"ok"})),versions:{groups:[row,{...row,target_deployment:{...a,release:"b"}}],total_groups:2,truncated:false}};
 assert.equal(validExternalSnapshot(fixture),true);
 fixture.versions.groups[1]!.target_deployment={schema_version:112,go_version:"",source_modified:null,source_revision:"",release:"a",environment:"local"};
 assert.equal(validExternalSnapshot(fixture),false);
});
