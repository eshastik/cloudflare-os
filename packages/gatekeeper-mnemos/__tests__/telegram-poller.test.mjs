import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {TelegramPoller} from "./src/telegram-poller.ts"',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'worker-base',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'base',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class DurableObject {constructor(ctx){this.ctx=ctx}}'}));}}]});
const {TelegramPoller}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
function setup(){
 const values=new Map();let alarm=null,run=async()=>({enabled:true,more:false});
 const ctx={storage:{kv:{get:k=>values.get(k),put:(k,v)=>values.set(k,structuredClone(v)),delete:k=>values.delete(k)},setAlarm:async n=>{alarm=n},deleteAlarm:async()=>{alarm=null}},exports:{TelegramBot:{idFromName:x=>x,get:()=>({pollInput:e=>run(e)})}}};
 return {poller:new TelegramPoller(ctx),ctx,values,setRun:f=>{run=f},alarm:()=>alarm};
}
test('empty success, failure and disabled transport have distinct diagnostics without error contents',async()=>{
 const h=setup(),p=h.poller;await p.start('123',first);assert.equal((await p.getStatus()).state,'starting');
 await p.alarm();const success=await p.getStatus();assert.equal(success.state,'ok');assert(success.lastSuccessAt>0);
 h.setRun(async()=>{throw Error('credential must never be stored')});await p.alarm();await p.alarm();
 const failed=await p.getStatus();assert.equal(failed.state,'error');assert.equal(failed.consecutiveErrors,2);assert.equal(failed.lastSuccessAt,success.lastSuccessAt);assert(h.alarm());assert(!JSON.stringify([...h.values]).includes('credential'));
 const restored=new TelegramPoller(h.ctx);assert.deepEqual(await restored.getStatus(),failed);
 h.setRun(async()=>({enabled:true,more:false}));await restored.alarm();assert.equal((await restored.getStatus()).consecutiveErrors,0);
 h.setRun(async()=>({enabled:false,more:false}));await restored.alarm();assert.equal((await restored.getStatus()).state,'disabled');assert.equal(h.alarm(),null);
});
test('late failure cannot overwrite a new epoch',async()=>{
 const h=setup();await h.poller.start('123',first);let reject,entered;const ready=new Promise(r=>{entered=r});h.setRun(()=>{entered();return new Promise((_,r)=>{reject=r})});
 const pending=h.poller.alarm();await ready;await h.poller.start('123',second);reject(Error('old transport'));await pending;
 assert.equal((await h.poller.getStatus()).state,'starting');assert.equal(h.values.get('registration').epoch,second);
});
