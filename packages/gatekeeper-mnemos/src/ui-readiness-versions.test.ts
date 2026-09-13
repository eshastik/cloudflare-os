import { test } from 'node:test';import assert from 'node:assert/strict';
import { validUIReadinessVersions } from './ui-readiness-metrics.ts';
test('version groups preserve unknown builds and expose truncation honestly',()=>{
 const group={client_version:'',surface:'cloudflareos.shell',outcome:'ready',samples:1,p50_ms:1,p95_ms:1,p99_ms:1,last_observed_at:'2026-09-08T13:00:00Z'};
 assert.equal(validUIReadinessVersions({groups:[group],total_groups:1,truncated:false}),true);
 assert.equal(validUIReadinessVersions({groups:[group,group],total_groups:2,truncated:false}),false);
 assert.equal(validUIReadinessVersions({groups:[group],total_groups:101,truncated:true}),false);
 const groups=Array.from({length:100},(_,i)=>({...group,client_version:`asset:index-${i}.js`}));
 assert.equal(validUIReadinessVersions({groups,total_groups:101,truncated:true}),true);
 assert.equal(validUIReadinessVersions({groups,total_groups:101,truncated:false}),false);
 assert.equal(validUIReadinessVersions({groups:[{...group,client_version:'https://host'}],total_groups:1,truncated:false}),false);
});
test('the same client build may have distinct receiving API versions',()=>{
 const group={client_version:'asset:same.js',surface:'cloudflareos.shell',outcome:'ready',samples:1,p50_ms:1,p95_ms:1,p99_ms:1,last_observed_at:'2026-09-08T13:00:00Z'};
 const deployment={environment:'test',release:'a',source_revision:'',source_modified:null,go_version:'',schema_version:109};
 const groups=[group,{...group,deployment},{...group,deployment:{...deployment,release:'b'}}];
 assert.equal(validUIReadinessVersions({groups,total_groups:3,truncated:false}),true);
 assert.equal(validUIReadinessVersions({groups:[group,{...group,deployment:null}],total_groups:2,truncated:false}),false);
 const reordered={schema_version:109,go_version:'',source_modified:null,source_revision:'',release:'a',environment:'test'};
 assert.equal(validUIReadinessVersions({groups:[groups[1],{...group,deployment:reordered}],total_groups:2,truncated:false}),false);
});
