import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url=source=>'data:text/javascript;base64,'+Buffer.from(compile(source)).toString('base64');
const ast=ts.createSourceFile('google.ts',read('google.ts'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declarations=['PendingActionStore','GoogleCalendarGatekeeperImpl','priorCalendarPatch'].map(name=>{const node=ast.statements.find(n=>n.name?.text===name);assert(node);return node.getText(ast)}).join('\n');
const module=await import(url(`import {assertCalendarWriteAccess} from ${JSON.stringify(url(read('calendar-access.ts')))};
export const state={writes:0,reads:0,lost:false,beforeRead:async()=>{},beforeWrite:async()=>{}};
class DurableObject{constructor(ctx){this.ctx=ctx}};class AccessTokenCache{}
const eventPatchToGoogle=value=>value;
class GoogleCalendarApi {
 async getEvent(){state.reads++;await state.beforeRead();return {id:'event',title:'Before'}}
 async write(){state.writes++;await state.beforeWrite();if(state.lost)throw Error('private provider diagnostics');return {id:'event'}}
 createEvent(){return this.write()}
 patchEvent(){return this.write()}
 deleteEvent(){return this.write()}
}
${declarations}`));
const {GoogleCalendarGatekeeperImpl,state}=module;
function fixture(type='createEvent'){
 Object.assign(state,{writes:0,reads:0,lost:false,beforeRead:async()=>{},beforeWrite:async()=>{}});
 const rows=new Map([['pending:action:1',{type,calendarId:'calendar',eventId:'event',event:{title:'Approved'},patch:{title:'After'},sendUpdates:'all'}]]);
 const props={accessMode:'manage'};
 const ctx={props,storage:{kv:{get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value)),delete:key=>rows.delete(key)}}};
 return {rows,props,create:()=>new GoogleCalendarGatekeeperImpl(ctx)};
}
test('create and update do not repeat unknown writes after restart or overwrite undo data',async()=>{
 for(const type of ['createEvent','updateEvent']){
  const f=fixture(type);state.lost=true;
  await assert.rejects(f.create().applyAction(1),error=>error.message.includes('unconfirmed')&&!error.message.includes('private'));
  state.lost=false;const reads=state.reads;
  await assert.rejects(f.create().applyAction(1),/unconfirmed/);assert.equal(state.writes,1);assert.equal(state.reads,reads);
  await assert.rejects(f.create().rejectAction(1),/unconfirmed/);assert(f.rows.has('pending:action:1'));
 }
});
test('overlapping approvals and lost caller ACK cause one write and retain the original undo patch',async()=>{
 const f=fixture('updateEvent');let release;
 state.beforeWrite=()=>new Promise(resolve=>{release=resolve});
 const first=f.create().applyAction(1);await new Promise(resolve=>setTimeout(resolve,0));
 await assert.rejects(f.create().applyAction(1),/unconfirmed/);release();await first;
 const revert=f.rows.get('revert:info:1');assert.deepEqual(revert.previous,{title:'Before'});
 await f.create().applyAction(1);assert.equal(state.writes,1);assert.deepEqual(f.rows.get('revert:info:1'),revert);assert(!f.rows.has('pending:action:1'));
});
test('undo cannot duplicate invitation notifications on an uncertain result or acknowledged retry',async()=>{
 for(const type of ['createEvent','updateEvent']){
  const f=fixture(type);await f.create().applyAction(1);state.lost=true;
  await assert.rejects(f.create().revertAction(1),/unconfirmed/);state.lost=false;
  await assert.rejects(f.create().revertAction(1),/unconfirmed/);assert.equal(state.writes,2);
  const ok=fixture(type);await ok.create().applyAction(1);await ok.create().revertAction(1);await ok.create().revertAction(1);assert.equal(state.writes,2);assert(!ok.rows.has('revert:info:1'));
 }
});
test('rejection during update preparation and read-only retries cannot reach the write',async()=>{
 const f=fixture('updateEvent');state.beforeRead=async()=>{await f.create().rejectAction(1)};
 await assert.rejects(f.create().applyAction(1),/no longer pending/);assert.equal(state.writes,0);
 const g=fixture();await g.create().applyAction(1);g.props.accessMode='read';await assert.rejects(g.create().applyAction(1),/read-only/);await assert.rejects(g.create().revertAction(1),/read-only/);assert.equal(state.writes,1);
});
