import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('./account-session.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {MnemosAccount}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const human={subject:{tenant_id:'tenant',user_id:'owner'}};
const receipt={connection_id:'connection',project_id:'project',provider:'google',calendar_id:'calendar',revision:2,enabled:false};
function storage(){const map=new Map<string,unknown>();return {get:<T>(key:string)=>map.get(key) as T|undefined,put:<T>(key:string,value:T)=>{map.set(key,value);},delete:(key:string)=>{map.delete(key);}};}
test('Calendar management uses owner API routes and preserves explicit revoke',async()=>{
 const seen:{path:string;body:any}[]=[];let count=0;
 const account=new MnemosAccount(storage(),'https://memory.example',async(input,init)=>{
  if(++count===1)return Response.json(human);
  const path=new URL(String(input)).pathname;const body=init?.body?JSON.parse(String(init.body)):undefined;seen.push({path,body});
  return Response.json(path.endsWith('/grants')?{revision:3}:path.endsWith('/disable')?{disabled:true}:receipt);
 });
 await account.connect('human-token');const session=account.session();
 assert.deepEqual(await session.readCalendarConnection('connection'),receipt);
 await session.registerCalendarConnection('project','request','selection');
 await session.setCalendarReadGrant('connection',{principal_id:'agent',connection_revision:2,expected_revision:2,enabled:false});
 await session.disableCalendarConnection('connection',2);
 assert.deepEqual(seen.map(x=>x.path),['/v1/calendar-connections/connection','/v1/projects/project/calendars','/v1/calendar-connections/connection/grants','/v1/calendar-connections/connection/disable']);
 assert.deepEqual(seen[1].body,{request_id:'request',selection_id:'selection'});assert.equal(seen[2].body.enabled,false);session.dispose();
});
test('Disconnect during calendar receipt read withholds the result',async()=>{
 let finish!:(value:Response)=>void;let count=0;
 const account=new MnemosAccount(storage(),'https://memory.example',async()=>++count===1?Response.json(human):new Promise(resolve=>{finish=resolve;}));
 await account.connect('human-token');const session=account.session();const pending=session.readCalendarConnection('connection');
 await new Promise(resolve=>setTimeout(resolve,0));account.disconnect();finish(Response.json(receipt));await assert.rejects(pending);session.dispose();
});

test('Saved calendar survives expired human login, but disconnect fences pending reads and same-owner reconnect',async t=>{
 const {CalendarSelections}=await import('./calendar-selection.ts');
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const kv=storage();let user='owner';
 const account=new MnemosAccount(kv,'https://memory.example',async()=>Response.json({subject:{tenant_id:'tenant',user_id:user}}));
 assert.equal(account.calendarEpoch(),undefined);
 await account.connect('human-token',now+1000);
 const epoch=account.calendarEpoch();assert.ok(epoch);
 const selections=new CalendarSelections(kv);
 let duringRead=()=>{};
 const source={validate:async()=>{},metadata:async()=>({provider:'google',calendar_id:'calendar',title:'Team',time_zone:'UTC'}),readWindow:async()=>{duringRead();return {calendar_id:'calendar',time_zone:'UTC',events_json:'[{"id":"event"}]',truncated:false};}};
 const selected=await selections.prepare({tenant:'tenant',owner:'owner',epoch},'project','request','source',source as any,async()=>{});
 const read={selection_id:'opaque',tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:selected.selection_id,calendar_id:'calendar',time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-11T00:00:00Z',limit:1};
 now+=1001;
 assert.throws(()=>account.session());
 // A cancelled browser login must not cancel the independent calendar association.
 kv.put('loginRevocationEpoch','cancelled-login');
 assert.equal((await selections.readWindow(selected.selection_id,read,()=>account.calendarEpoch())).events.length,1);
 await account.connect('renewed-human-token',now+1000);
 assert.equal(account.calendarEpoch(),epoch);
 user='other-owner';await assert.rejects(account.connect('other-token',now+1000));user='owner';
 duringRead=()=>account.disconnect();
 await assert.rejects(selections.readWindow(selected.selection_id,read,()=>account.calendarEpoch()),/unavailable/);
 assert.equal(account.calendarEpoch(),undefined);
 await account.connect('reconnected-human-token',now+1000);
 assert.notEqual(account.calendarEpoch(),epoch);
 await assert.rejects(selections.readWindow(selected.selection_id,read,()=>account.calendarEpoch()),/unavailable/);
});
