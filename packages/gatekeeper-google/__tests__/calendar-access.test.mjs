import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const compile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(compile(text)).toString('base64');
const accessURL=url(read('calendar-access.ts'));
const authURL=url(read('auth-retry.ts'));
const apiURL='data:text/javascript;base64,'+Buffer.from(compile(read('calendar-api.ts')).replace('"temporal-polyfill"',JSON.stringify(import.meta.resolve('temporal-polyfill'))).replace('"./auth-retry"',JSON.stringify(authURL))).toString('base64');
const {calendarAccessMode,assertCalendarWriteAccess}=await import(accessURL);
// Execute the real session and durable-object classes with only their runtime ports stubbed.
const ast=ts.createSourceFile('google.ts',read('google.ts'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const selected=['GoogleCalendarSessionImpl','GoogleCalendarGatekeeperImpl'].map(name=>{const node=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===name);assert(node);return node.getText(ast).replace(/^class GoogleCalendarSessionImpl/,'export class GoogleCalendarSessionImpl');}).join('\n');
const helpers=['applyPendingCalendarActions','pendingCalendarEventFromDraft','applyCalendarPatchToEvent'].map(name=>{const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(node);return node.getText(ast);}).join('\n');
const module=await import(url(`import {calendarEventOverlaps,calendarEventSortKey,validateCalendarTimeWindow} from ${JSON.stringify(apiURL)};
${helpers}
import {calendarAccessMode,assertCalendarWriteAccess} from ${JSON.stringify(accessURL)};
export const calls={storage:0,network:0};
class RpcTarget{};class DurableObject{constructor(ctx){this.ctx=ctx;}};class AccessTokenCache{}
class PendingActionStore{constructor(){calls.storage++;throw Error('unexpected storage');}}
class GoogleCalendarApi{constructor(){calls.network++;throw Error('unexpected network');}}
${selected}`));
test('Read-only binding blocks queueing, direct apply and revert before storage or network',async()=>{
 const {GoogleCalendarSessionImpl,GoogleCalendarGatekeeperImpl,calls}=module;let observed=0;
 const queue={authorizeObservation:async()=>{observed++;},submitAction:async()=>{throw Error('unexpected approval');}};
 const session=new GoogleCalendarSessionImpl({getCalendar:async()=>({id:'calendar',summary:'Shared calendar'})},'calendar','thisCalendar',queue,{submit(){throw Error('unexpected pending write');}},async()=>({}),'read');
 assert.deepEqual(await session.getCapabilities(),{availabilityMode:'thisCalendar',accessMode:'read'});
 assert.equal((await session.getCalendar()).id,'calendar');assert.equal(observed,1);
 await assert.rejects(session.createEvent({}),/read-only/);await assert.rejects(session.updateEvent('event',{}),/read-only/);
 const gatekeeper=new GoogleCalendarGatekeeperImpl({props:{accessMode:'read'},storage:{kv:{get(){throw Error('unexpected storage');}}}});
 await assert.rejects(gatekeeper.applyAction(1),/read-only/);await assert.rejects(gatekeeper.revertAction(1),/read-only/);assert.deepEqual(calls,{storage:0,network:0});
});
test('Explicit modes are validated and old bindings retain their previous management mode',()=>{
 assert.equal(calendarAccessMode('read'),'read');assert.equal(calendarAccessMode(null),'manage');assert.equal(calendarAccessMode(undefined),'manage');assert.doesNotThrow(()=>assertCalendarWriteAccess(undefined));assert.throws(()=>calendarAccessMode('unknown'));assert.throws(()=>assertCalendarWriteAccess('read'),/read-only/);
});

test('Session lists pending all-day events in the selected calendar zone and requires metadata',async()=>{
 let metadata=0,observations=0;
 const event={title:'Day',start:{kind:'date',date:'2026-09-10'},end:{kind:'date',date:'2026-09-11'}};
 let pending=[{id:1,action:{type:'createEvent',event}}];
 let timeZone='Europe/Moscow';
 const session=new module.GoogleCalendarSessionImpl({listEvents:async()=>[],getCalendar:async id=>{assert.equal(id,'selected');metadata++;return {id,timeZone};}},'selected','thisCalendar',{authorizeObservation:async()=>{observations++;}},{list:()=>pending},async()=>({}),'read');
 const opts={timeMin:new Date('2026-09-09T21:30:00Z'),timeMax:new Date('2026-09-09T22:00:00Z')};
 assert.equal((await session.listEvents(opts))[0].id,'pending:create:1');assert.equal(metadata,1);assert.equal(observations,1);
 assert.deepEqual(await session.listEvents({timeMin:new Date('2026-09-10T21:00:00Z'),timeMax:new Date('2026-09-10T22:00:00Z')}),[]);
 timeZone=undefined;await assert.rejects(session.listEvents(opts),/time zone is unavailable/);assert.equal(observations,2);
 pending=[];metadata=0;assert.deepEqual(await session.listEvents(opts),[]);assert.equal(metadata,0);
});
