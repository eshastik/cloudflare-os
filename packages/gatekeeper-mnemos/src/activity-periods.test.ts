import { test } from "node:test";
import assert from "node:assert/strict";
import { validActivityWindows } from "./activity-periods.ts";

test("activity windows distinguish missing recent coverage and reject impossible totals",()=>{
 const data={first_observed_at:"2026-08-01T00:00:00Z",observed_at:"2026-09-08T00:00:00Z",windows:[{days:1,reporting_users:0,active_users:0},{days:7,reporting_users:2,active_users:1},{days:30,reporting_users:3,active_users:2}]};
 assert.equal(validActivityWindows(data),true);
 for (const patch of [{reporting_users:0},{active_users:4},{days:7}]) {
  const bad=structuredClone(data);Object.assign(bad.windows[2]!,patch);assert.equal(validActivityWindows(bad),false);
 }
 assert.equal(validActivityWindows({...data,first_observed_at:"2027-01-01T00:00:00Z"}),false);
});
