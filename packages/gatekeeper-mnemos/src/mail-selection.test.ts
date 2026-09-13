import test from 'node:test';
import assert from 'node:assert/strict';
import {MailSelections} from './mail-selection.ts';
import type {MailReadSource} from '@gadgets/workshop-shared/gatekeeper';

const owner = {tenant:'tenant', owner:'owner', epoch:'epoch'};
function fixture() {
  const records = new Map<string, unknown>();
  const storage = {get:<T>(key:string)=>records.get(key) as T|undefined,
    put:<T>(key:string,value:T)=>{records.set(key,value);}, delete:(key:string)=>{records.delete(key);}};
  let live=true, epoch:string|undefined='epoch', calls=0;
  let result={provider:'google',query:'label:team',messages_json:'[{"message_id":"mail1","body":"selected"}]',truncated:false};
  let afterRead=()=>{};
  const source={metadata:async()=>({provider:'google',query:'label:team'}),
    validate:async()=>{if(!live)throw Error('revoked');},
    readSelection:async()=>{calls++;afterRead();return result;}} as Fetcher<MailReadSource>;
  const store=new MailSelections(storage);
  return {records,source,store,currentEpoch:()=>epoch,calls:()=>calls,
    revoke:()=>{live=false;}, revokeOwner:()=>{epoch=undefined;},
    setResult:(next:typeof result)=>{result=next;}, afterRead:(fn:()=>void)=>{afterRead=fn;},
    prepare:()=>store.prepare(owner,'project','request','source',source,async()=>{}),
    result:()=>result};
}
async function selected() {
  const f=fixture(), selection=await f.prepare();
  const record=await f.store.resolve(selection.selection_id,{tenant:'tenant',owner:'owner',project:'project',request:'request'},f.currentEpoch);
  const input={selection_id:'account.'+selection.selection_id,tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:selection.selection_id,query_sha256:record.querySHA256,limit:2};
  return {...f,id:selection.selection_id,input};
}
test('Mail selection retries converge and cannot replace the selected source',async()=>{
  const f=fixture(); const [a,b]=await Promise.all([f.prepare(),f.prepare()]);
  assert.deepEqual(a,b);assert.equal(f.records.size,2);
  await assert.rejects(f.store.prepare(owner,'project','request','other',f.source,async()=>{}),/changed/);
  f.revoke();await assert.rejects(f.prepare(),/revoked/);
});
test('Mail read binds project, owner and query before provider access',async()=>{
  const f=await selected();
  for(const patch of [{owner_id:'other'},{project_id:'other'},{tenant_id:'other'},{query_sha256:'b'.repeat(64)},{connection_id:'other'},{limit:11}]) {
    await assert.rejects(f.store.readSelection(f.id,{...f.input,...patch},f.currentEpoch));
  }
  assert.equal(f.calls(),0);
  const result=await f.store.readSelection(f.id,f.input,f.currentEpoch);
  assert.equal(result.query_sha256,f.input.query_sha256);
  assert.deepEqual(result.messages,[{message_id:'mail1',body:'selected'}]);
});
test('Revocation during mail read withholds the provider result',async()=>{
  for(const kind of ['source','owner']) {
    const f=await selected();f.afterRead(kind==='source'?f.revoke:f.revokeOwner);
    await assert.rejects(f.store.readSelection(f.id,f.input,f.currentEpoch));
    assert.equal(f.calls(),1);
  }
});
test('Mail source substitution and invalid message results are rejected',async()=>{
  for(const patch of [{provider:'imap'},{query:'in:anywhere'},
    {messages_json:'null'},{messages_json:'[{"message_id":"x"},{"message_id":"x"}]'},
    {messages_json:JSON.stringify([{message_id:'x'.repeat(256)}])},
    {messages_json:JSON.stringify([{message_id:'x\n'}])},
    {messages_json:JSON.stringify([{message_id:'x',body:'x'.repeat(512*1024)}])}]) {
    const f=await selected();f.setResult({...f.result(),...patch});
    await assert.rejects(f.store.readSelection(f.id,f.input,f.currentEpoch));
  }
});
