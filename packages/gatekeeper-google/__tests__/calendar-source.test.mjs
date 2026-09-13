import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const compile=name=>ts.transpileModule(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const apiURL=url(compile('calendar-api.ts').replace('"./auth-retry"',JSON.stringify(url(compile('auth-retry.ts')))).replace('"temporal-polyfill"',JSON.stringify(import.meta.resolve('temporal-polyfill'))));
const {SelectedCalendarReader}=await import(url(compile('calendar-source.ts').replace('"./calendar-api"',JSON.stringify(apiURL)).replace('"temporal-polyfill"',JSON.stringify(import.meta.resolve('temporal-polyfill')))));
const input={time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-11T00:00:00Z',limit:1};
function fixture(){
 const state={generation:'one',calls:[],onMetadata(){},onEvents(){}};
 const api={getCalendar:async id=>{state.calls.push(['metadata',id]);state.onMetadata();return {id,summary:'Team',timeZone:'Europe/Moscow'};},listEvents:async (id,opts)=>{state.calls.push(['events',id]);assert.equal(opts.includeDescriptions,true);state.onEvents();return [{id:'first'},{id:'second'}];}};
 return {state,reader:new SelectedCalendarReader(api,'selected','one',async()=>state.generation)};
}
test('Persistent source reads only the selected calendar and reports truncation',async()=>{
 const {state,reader}=fixture();assert.deepEqual(await reader.readWindow(input),{calendar_id:'selected',time_zone:'Europe/Moscow',events_json:JSON.stringify([{id:'first'}]),truncated:true});assert.deepEqual(state.calls,[['metadata','selected'],['events','selected']]);assert.equal(reader.createEvent,undefined);assert.equal(reader.updateEvent,undefined);
});
test('Generation changes withhold metadata and event responses',async()=>{
 for(const when of ['before','metadata','events']){const {state,reader}=fixture();const revoke=()=>{state.generation='two';};if(when==='before')revoke();else if(when==='metadata')state.onMetadata=revoke;else state.onEvents=revoke;await assert.rejects(reader.readWindow(input),/changed/);assert.equal(state.calls.length,{before:0,metadata:1,events:2}[when]);}
});
test('Window validation rejects attempts to select other calendars or exceed bounds',async()=>{
 for(const bad of [{...input,calendar_id:'other'},{...input,time_min:'2026-02-30T00:00:00Z'},{...input,limit:0},{...input,limit:101},{...input,time_min:'2026-09-10T00:00:00'},{...input,time_max:input.time_min}]){const {state,reader}=fixture();await assert.rejects(reader.readWindow(bad));assert.equal(state.calls.length,0);}
 assert.throws(()=>new SelectedCalendarReader({},'primary','one',async()=> 'one'));
});

test('Account revoke invalidates sources before remote I/O even if Google revoke fails',async()=>{
 const source=readFileSync(new URL('../src/google.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('google.ts',source,ts.ScriptTarget.Latest,true);
 const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='UserAccount');
 const methods=['calendarSourceGeneration','revoke'].map(name=>cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)===name).getText(ast)).join('\n');
 const code=ts.transpileModule(`const TOKEN_REVOKE_TIMEOUT_MS=1000;export let remote;const revokeGoogleToken=async()=>remote();export function setRemote(fn){remote=fn;}export class Account{constructor(public ctx){}async #updateCredentials(fn){return fn();}${methods}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const module=await import(url(code));const kv=new Map([['refreshToken','test-only']]);kv.put=(key,value)=>kv.set(key,value);const account=new module.Account({storage:{kv,deleteAlarm(){},deleteAll(){kv.clear();}}});
 const before=await account.calendarSourceGeneration();assert.equal(await account.calendarSourceGeneration(),before);
 module.setRemote(async()=>{await assert.rejects(account.calendarSourceGeneration(),/disconnected/);throw Error('provider unavailable');});
 await assert.rejects(account.revoke(),/provider unavailable/);await assert.rejects(account.calendarSourceGeneration(),/disconnected/);
});
