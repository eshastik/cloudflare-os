import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {davFixture,origin} from '../../caldav-client/__tests__/fixture.mjs';
const dir=await mkdtemp(join(tmpdir(),'mnemos-caldav-account-'));test.after(()=>rm(dir,{recursive:true,force:true}));
const compile=async(name,entry)=>{const outfile=join(dir,name+'.mjs');await build({entryPoints:[entry],bundle:true,platform:'browser',format:'esm',outfile});return import(pathToFileURL(outfile).href)};
const {CalDAVAccounts,caldavServers}=await compile('accounts','src/caldav-accounts.ts');const {approvedCalendarData}=await compile('events','../caldav-client/src/events.ts');
const owner={tenant:'tenant',owner:'owner',epoch:'epoch'},input={request:'11111111-1111-4111-8111-111111111111',server:'corp-fixture',username:'owner@example.test',password:'private-app-password'};
function fixture(){const rows=new Map(),provider=davFixture(approvedCalendarData);let epoch=owner.epoch;const servers=caldavServers(JSON.stringify([{id:'corp-fixture',title:'Fixture',url:origin,origins:[origin]}]));return {rows,provider,setEpoch:value=>{epoch=value},create:()=>new CalDAVAccounts({get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value)),delete:key=>rows.delete(key)},servers,()=>epoch,provider.fetcher)};}
test('owner setup survives restart, returns no password/URLs and removes the password and old source authority',async()=>{
 const f=fixture(),result=await f.create().connect(owner,input);assert.equal(result.enabled,true);assert.equal(result.calendars.length,1);assert(!JSON.stringify(result).includes(input.password));assert(!JSON.stringify(result).includes('/calendars/'));
 assert.deepEqual(await f.create().connect(owner,input),result);await assert.rejects(f.create().connect(owner,{...input,password:'different'}),/changed/);
 assert.deepEqual(f.rows.get('caldavAccount:'+input.request).connection_audit.map(e=>e.phase),['connecting','enabled']);
 const calendar=result.calendars[0].id,selected=f.create().select(owner,calendar);assert.equal(selected.metadata.provider,'caldav');
 for(const other of [{...owner,owner:'other'},{...owner,tenant:'other'},{...owner,epoch:'other'}]){assert.throws(()=>f.create().select(other,calendar));assert.throws(()=>f.create().remove(other,result.id));}
 const read=await f.create().readWindow(calendar,selected.generation,{time_min:'2026-09-11T00:00:00Z',time_max:'2026-09-12T00:00:00Z',limit:10});assert.equal(JSON.parse(read.events_json)[0].summary,'Team meeting');
 f.create().remove(owner,result.id);assert(!JSON.stringify([...f.rows]).includes(input.password));assert.throws(()=>f.create().validate(calendar,selected.generation));
 assert.deepEqual(f.rows.get('caldavAccount:'+input.request).connection_audit.map(e=>e.phase),['connecting','enabled','removed']);
 await f.create().connect(owner,input);assert.throws(()=>f.create().validate(calendar,selected.generation));f.setEpoch('disconnected');assert.throws(()=>f.create().list(owner));
});
test('disconnect during setup cannot retain credentials or re-enable an account',async()=>{
 const f=fixture();f.setEpoch('other');await assert.rejects(f.create().connect(owner,input));assert(!JSON.stringify([...f.rows]).includes(input.password));
 f.setEpoch(owner.epoch);const fetcher=f.provider.fetcher;f.provider.fetcher=async(...args)=>{const result=await fetcher(...args);f.setEpoch('disconnected');return result;};await assert.rejects(f.create().connect(owner,input));assert(!JSON.stringify([...f.rows]).includes(input.password));
 f.provider.fetcher=fetcher;f.setEpoch(owner.epoch);f.provider.state.foreign=true;await assert.rejects(f.create().connect(owner,input));assert(!JSON.stringify([...f.rows]).includes(input.password));assert.deepEqual(f.create().list(owner).accounts,[]);
});

test('invitation check is limited to the current owner and returns no credentials',async()=>{
 const f=fixture(),account=await f.create().connect(owner,input),calendar=account.calendars[0].id;
 assert.deepEqual(await f.create().checkScheduling(owner,calendar),{calendar_id:calendar,available:true});assert.equal(f.provider.state.writes.length,0);
 const before=f.provider.state.calls.length;await assert.rejects(f.create().checkScheduling({...owner,owner:'other'},calendar));assert.equal(f.provider.state.calls.length,before);
 f.provider.state.scheduling=false;assert.deepEqual(await f.create().checkScheduling(owner,calendar),{calendar_id:calendar,available:false});
 f.create().remove(owner,account.id);await assert.rejects(f.create().checkScheduling(owner,calendar));
});
