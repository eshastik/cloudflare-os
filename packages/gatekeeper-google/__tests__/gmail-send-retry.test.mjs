import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('../src/google.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('google.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const classes=['PendingActionStore','GmailGatekeeperImpl'].map(name=>{const node=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===name);assert(node);return node.getText(ast)}).join('\n');
const source=`export const state={sends:0,mode:'ok',beforeSend:async()=>{},beforeBuild:async()=>{}};
const validateRpc=()=>target=>target;
class DurableObject{constructor(ctx){this.ctx=ctx}};class AccessTokenCache{}
class GmailApi{
 buildSendRaw(){return {raw:'fixture-mime'}}
 async getMessage(){await state.beforeBuild();return {}}
 async buildReplyRaw(){return {raw:'fixture-mime'}}
 async buildForwardRaw(){return {raw:'fixture-mime'}}
 async sendRawMessage(){state.sends++;await state.beforeSend();if(state.mode==='lost')throw Error('private transport diagnostics');return {id:'sent'}}
}
${classes}`;
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {GmailGatekeeperImpl,state}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function fixture(action){const records=new Map([['selfEmail','owner@example.test'],['pending:action:1',action]]);const ctx={props:{},storage:{kv:{get:key=>records.get(key),put:(key,value)=>records.set(key,value),delete:key=>records.delete(key)}}};return {records,create:()=>new GmailGatekeeperImpl(ctx)}}
test('send/reply/forward never repeat after uncertain provider outcome, including restart',async()=>{
 for(const type of ['send','reply','forward']){
  state.sends=0;state.mode='lost';const f=fixture({type,to:['recipient@example.test'],subject:'Subject',body:'Body',sourceMessageId:'original',threadId:'thread'});
  await assert.rejects(f.create().applyAction(1),/unconfirmed/);assert.equal(state.sends,1);assert(f.records.has('pending:action:1'));
  state.mode='ok';await assert.rejects(f.create().applyAction(1),/unconfirmed/);assert.equal(state.sends,1);
 }
});
test('confirmed sends tolerate lost caller ACK; overlapping approvals send only once',async()=>{
 state.sends=0;state.mode='ok';let release;state.beforeSend=()=>new Promise(resolve=>{release=resolve});
 const f=fixture({type:'send'}),worker=f.create(),first=worker.applyAction(1);
 await new Promise(resolve=>setTimeout(resolve,0));await assert.rejects(worker.applyAction(1),/unconfirmed/);release();await first;
 assert.equal(state.sends,1);assert(!f.records.has('pending:action:1'));await f.create().applyAction(1);assert.equal(state.sends,1);state.beforeSend=async()=>{};
});
test('rejection while preparing a reply prevents the provider send',async()=>{
 state.sends=0;const f=fixture({type:'reply'});state.beforeBuild=async()=>{f.records.delete('pending:action:1')};
 await assert.rejects(f.create().applyAction(1),/no longer pending/);assert.equal(state.sends,0);state.beforeBuild=async()=>{};
});
