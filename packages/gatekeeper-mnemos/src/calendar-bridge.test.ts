import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCalendarBridge} from './calendar-bridge.ts';
import {CalendarSelections} from './calendar-selection.ts';
import type {CalendarReadSource} from '@gadgets/workshop-shared/gatekeeper';
const base='https://workshop.example/gatekeeper/mnemos';
const token='test-only-service-token-32-characters';
const selection='a'.repeat(64)+'.11111111-2222-4333-8444-555555555555';
const input={selection_id:selection,tenant_id:'tenant',owner_id:'owner',project_id:'project',request_id:'request'};
function request(body:unknown=input,auth='Bearer '+token,path=base+'/calendar-bridge/resolve') {return new Request(path,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)});}
test('Calendar relay authenticates before account lookup and rejects extra authority fields',async()=>{
 let calls=0;const resolve=async(account:string,body:typeof input)=>{calls++;assert.equal(account,'a'.repeat(64));assert.deepEqual(body,input);return {connection_id:'connection',owner_id:'owner',project_id:'project',provider:'google',calendar_id:'calendar',bridge_handle:selection,revision:1,enabled:true};};
 assert.equal((await handleCalendarBridge(request(),'bad-url',token,resolve)),null);
 assert.equal((await handleCalendarBridge(request(),base,undefined,resolve))?.status,503);
 assert.equal((await handleCalendarBridge(request(input,'wrong'),base,token,resolve))?.status,403);
 for(const body of [{...input,token:'unexpected'},{...input,selection_id:'wrong'}, {...input,owner_id:'x'.repeat(17000)}])assert.equal((await handleCalendarBridge(request(body),base,token,resolve))?.status,403);
 assert.equal((await handleCalendarBridge(request(input,undefined,'https://other.example/gatekeeper/mnemos/calendar-bridge/resolve'),base,token,resolve))?.status,404);
 assert.equal(calls,0);
 const response=await handleCalendarBridge(request(),base,token,resolve);assert.equal(response?.status,200);assert.equal(response?.headers.get('Cache-Control'),'no-store');assert.equal(calls,1);
 const failed=await handleCalendarBridge(request(),base,token,async()=>{throw Error('private provider error');});assert.equal(failed?.status,403);assert.deepEqual(await failed?.json(),{code:'calendar.unavailable'});
});
test('Service selection lookup binds every owner coordinate and revocation epoch',async()=>{
 const records=new Map<string,unknown>();const storage={get:<T>(key:string)=>records.get(key) as T|undefined,put:<T>(key:string,value:T)=>{records.set(key,value);},delete:(key:string)=>{records.delete(key);}};
 const selections=new CalendarSelections(storage);let epoch='epoch';let duringValidate=()=>{};
 const source={metadata:async()=>({provider:'google',calendar_id:'calendar',title:'Calendar',time_zone:'UTC'}),validate:async()=>duringValidate()} as Fetcher<CalendarReadSource>;
 const prepared=await selections.prepare({tenant:'tenant',owner:'owner',epoch},'project','request','source',source,async()=>{});
 const expected={tenant:'tenant',owner:'owner',project:'project',request:'request'};
 assert.equal((await selections.resolve(prepared.selection_id,expected,()=>epoch)).id,prepared.selection_id);
 for(const field of ['tenant','owner','project','request'])await assert.rejects(selections.resolve(prepared.selection_id,{...expected,[field]:'other'},()=>epoch));
 duringValidate=()=>{epoch='revoked';};await assert.rejects(selections.resolve(prepared.selection_id,expected,()=>epoch));
});

test('Read relay preserves the selected calendar and withholds data after revocation',async()=>{
 const records=new Map<string,unknown>();const storage={get:<T>(key:string)=>records.get(key) as T|undefined,put:<T>(key:string,value:T)=>{records.set(key,value);},delete:(key:string)=>{records.delete(key);}};
 const selections=new CalendarSelections(storage);let epoch='epoch',mode='ok';
 const source={metadata:async()=>({provider:'google',calendar_id:'calendar',title:'Team',time_zone:'UTC'}),validate:async()=>{},readWindow:async()=>{if(mode==='revoke')epoch='revoked';return {calendar_id:mode==='wrong-calendar'?'other':'calendar',time_zone:'UTC',events_json:mode==='bad-events'?'[null]':'[{"id":"event","title":"private"}]',truncated:false};}} as Fetcher<CalendarReadSource>;
 const prepared=await selections.prepare({tenant:'tenant',owner:'owner',epoch},'project','request','source',source,async()=>{});
 const body={selection_id:'a'.repeat(64)+'.'+prepared.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:prepared.selection_id,calendar_id:'calendar',time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-11T00:00:00Z',limit:1};
 const read=async(_account:string,query:typeof body)=>selections.readWindow(prepared.selection_id,query,()=>epoch);
 const invoke=(query=body,auth='Bearer '+token)=>handleCalendarBridge(request(query,auth,base+'/calendar-bridge/read'),base,token,async()=>{throw Error('wrong operation');},read);
 assert.equal((await invoke(body,'wrong'))?.status,403);
 assert.equal((await invoke({...body,owner_id:'other'}))?.status,403);
 const ok=await invoke();assert.equal(ok?.status,200);assert.equal((await ok?.json() as any).events[0].id,'event');
 for(mode of ['wrong-calendar','bad-events','revoke'])assert.equal((await invoke())?.status,403);
});
