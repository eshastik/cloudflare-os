import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {UserAccount} from "./src/yandex.ts"',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'worker-base',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'worker',namespace:'base'}));b.onLoad({filter:/.*/,namespace:'base'},()=>({contents:'export class DurableObject{};export class WorkerEntrypoint{};',loader:'js'}));}}]});
const {UserAccount}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('a late expiry notification after reconnect is corrected and a failed restoration remains retryable',async()=>{
 const records=new Map([['connected',true],['expiryNotificationPending','old']]);let expired=0,restored=0;const alarms=[];
 records.set('callback',{
  async credentialsExpired(){expired++;records.set('grant',{});records.delete('expiryNotificationPending');},
  async credentialsRestored(){restored++;if(restored===1)throw Error('lost notification');},
 });
 const make=()=>Object.assign(Object.create(UserAccount.prototype),{ctx:{storage:{kv:{get:key=>records.get(key),put:(key,value)=>records.set(key,value),delete:key=>records.delete(key)},setAlarm:async at=>alarms.push(at)}}});
 await make().alarm();assert.ok(records.has('expiryNotificationPending'));assert.equal(expired,1);
 await make().alarm();assert.ok(records.has('expiryNotificationPending'));assert.equal(restored,1);
 await make().alarm();assert.equal(records.has('expiryNotificationPending'),false);assert.equal(restored,2);assert.equal(expired,1);assert.equal(alarms.length,2);
});
