import { test } from "node:test";
import assert from "node:assert/strict";
import { validOrganizationWork } from "./organization-metrics.ts";
test("collaboration timing distinguishes unknown waits and validates denominators",()=>{
 const empty={samples:0,p50_seconds:null,p95_seconds:null,p99_seconds:null};
 const sample={samples:1,p50_seconds:12,p95_seconds:12,p99_seconds:12};
 const data={first_publication_at:null,observed_at:"2026-09-12T00:00:00Z",periods:[1,7,30].map(days=>({days,publications:0,projects:0,has_completed_publication:false})),collaboration:{requests:2,results:1,reviewed_requests:0,reworked_requests:0,first_response:sample,first_review:empty}};
 assert.equal(validOrganizationWork(data),true);
 for (const patch of [{requests:0},{reviewed_requests:1},{reworked_requests:1},{first_review:{...empty,p50_seconds:0}},{first_response:{...sample,p95_seconds:11}},{first_response:{...sample,p99_seconds:Infinity}}]) {
  assert.equal(validOrganizationWork({...data,collaboration:{...data.collaboration,...patch}}),false);
 }
 assert.equal(validOrganizationWork({...data,collaboration:{...data.collaboration,reviewed_requests:1,reworked_requests:1,first_review:sample}}),true);
 assert.equal(validOrganizationWork({...data,collaboration:undefined}),true);
});
test("organization indicators do not confuse transitions with organizations",()=>{
 const data={first_publication_at:"2026-08-01T00:00:00Z",observed_at:"2026-09-08T00:00:00Z",periods:[1,7,30].map(days=>({days,publications:2,projects:1,has_completed_publication:true}))};
 assert.equal(validOrganizationWork(data),true);
 for(const patch of [{projects:3},{projects:0},{has_completed_publication:false},{publications:0}]){
  const bad=structuredClone(data);Object.assign(bad.periods[2]!,patch);assert.equal(validOrganizationWork(bad),false);
 }
 assert.equal(validOrganizationWork({...data,first_publication_at:null}),false);
 assert.equal(validOrganizationWork({...data,first_publication_at:null,periods:data.periods.map(p=>({...p,publications:0,projects:0,has_completed_publication:false}))}),true);
});
test("accepted requests require complete monotone counts and never default missing data to zero",()=>{
 const data={first_publication_at:null,first_acceptance_at:"2026-09-07T00:00:00Z",observed_at:"2026-09-08T00:00:00Z",periods:[1,7,30].map(days=>({days,publications:0,projects:0,has_completed_publication:false,accepted_requests:2,accepted_request_projects:1}))};
 assert.equal(validOrganizationWork(data),true);
 for(const patch of [{accepted_requests:undefined},{accepted_request_projects:3},{accepted_request_projects:0},{accepted_requests:-1},{accepted_requests:1.5},{accepted_requests:1}]){
  const bad=structuredClone(data);Object.assign(bad.periods[2]!,patch);assert.equal(validOrganizationWork(bad),false);
 }
 assert.equal(validOrganizationWork({...data,first_acceptance_at:null}),false);
 assert.equal(validOrganizationWork({...data,first_acceptance_at:undefined}),false);
 assert.equal(validOrganizationWork({...data,first_acceptance_at:"2026-09-09T00:00:00Z"}),false);
});

 test("completed projects form a union, not a sum of results",()=>{
 const data={first_publication_at:"2026-09-07T00:00:00Z",first_acceptance_at:"2026-09-07T00:00:00Z",observed_at:"2026-09-08T00:00:00Z",periods:[1,7,30].map(days=>({days,publications:3,projects:2,has_completed_publication:true,accepted_requests:4,accepted_request_projects:2,completed_projects:2,has_completed_work:true}))};
 assert.equal(validOrganizationWork(data),true);
 for (const count of [3,4]) assert.equal(validOrganizationWork({...data,periods:data.periods.map(p=>({...p,completed_projects:count}))}),true);
 for(const patch of [{completed_projects:1},{completed_projects:5},{completed_projects:undefined},{has_completed_work:false},{has_completed_work:undefined}]){
  const bad=structuredClone(data);Object.assign(bad.periods[2]!,patch);assert.equal(validOrganizationWork(bad),false);
 }
 const acceptedOnly={...data,first_publication_at:null,periods:data.periods.map(p=>({...p,publications:0,projects:0,has_completed_publication:false}))};
 assert.equal(validOrganizationWork(acceptedOnly),true);
 const empty={...acceptedOnly,first_acceptance_at:null,periods:acceptedOnly.periods.map(p=>({...p,accepted_requests:0,accepted_request_projects:0,completed_projects:0,has_completed_work:false}))};
 assert.equal(validOrganizationWork(empty),true);
 });
