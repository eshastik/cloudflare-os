import {test} from 'node:test';import assert from 'node:assert/strict';
import {validPlatformSignals} from './platform-signals.ts';
test('signal snapshots cannot report missing or failed evidence as healthy',()=>{
 const rows=['dependencies','external.readiness','external.login','external.read','external.save'].map(key=>({key,state:'unknown',reason:key==='dependencies'?'check_unavailable':'observations_missing',observed_at:null as string|null}));
 assert.equal(validPlatformSignals(rows),true);
 assert.equal(validPlatformSignals(rows.slice(1)),false);
 for(const patch of [{state:'ok'},{state:'ok',reason:'check_passed'},{key:'dependencies'},{reason:'check_failed'}]){
  const bad=structuredClone(rows);Object.assign(bad[3]!,patch);assert.equal(validPlatformSignals(bad),false);
 }
 rows[3]={key:'external.read',state:'firing',reason:'check_failed',observed_at:'2026-09-12T00:00:00Z'};assert.equal(validPlatformSignals(rows),true);
});
