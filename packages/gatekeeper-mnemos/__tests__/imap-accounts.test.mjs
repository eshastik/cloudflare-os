import test from 'node:test';
import assert from 'node:assert/strict';
import {ImapAccounts,imapServers} from '../src/imap-accounts.ts';

const owner={tenant:'tenant',owner:'owner',epoch:'epoch'};
const input={request:'11111111-1111-4111-8111-111111111111',server:'yandex',username:'owner@example.test',password:'private-app-password',mailbox:'INBOX'};
function fixture(){
  const rows=new Map();let epoch=owner.epoch,hook=()=>{};
  const reader=(_server,_credential,mailbox,validate)=>({
    checkMailbox:async()=>{await validate();hook();await validate();},
    metadata:async()=>({provider:'yandex',query:JSON.stringify({mailbox,order:'newest'})}),
    readSelection:async()=>{await validate();hook();return {provider:'yandex',query:JSON.stringify({mailbox,order:'newest'}),messages:[],truncated:false};},
  });
  return {rows,epoch:value=>{epoch=value},hook:value=>{hook=value},create:(servers=imapServers())=>new ImapAccounts({get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value)),delete:key=>rows.delete(key)},servers,()=>epoch,reader)};
}
test('private setup, restart, owner isolation, disconnect and old-generation refusal',async()=>{
  const f=fixture(),saved=await f.create().connect(owner,input);
  assert(saved.enabled);assert(!JSON.stringify(saved).includes(input.password));
  assert.deepEqual(await f.create().connect(owner,input),saved);
  await assert.rejects(f.create().connect(owner,{...input,mailbox:'other'}),/changed/);
 assert.deepEqual(f.rows.get('imapAccount:'+input.request).connection_audit.map(e=>e.phase),['connecting','enabled']);
  const source=f.create().select(owner,saved.id);
  for(const other of [{...owner,tenant:'other'},{...owner,owner:'other'},{...owner,epoch:'other'}]){
    assert.throws(()=>f.create().select(other,saved.id));assert.throws(()=>f.create().remove(other,saved.id));
  }
  assert.equal((await f.create().readSelection(saved.id,source.generation,{limit:1})).messages_json,'[]');
  f.create().remove(owner,saved.id);assert(!JSON.stringify([...f.rows]).includes(input.password));
 assert.deepEqual(f.rows.get('imapAccount:'+input.request).connection_audit.map(e=>e.phase),['connecting','enabled','removed']);
  await f.create().connect(owner,input);assert.throws(()=>f.create().validate(saved.id,source.generation));
  const current=f.create().select(owner,saved.id);
  f.hook(()=>f.create().remove(owner,saved.id));
  await assert.rejects(f.create().readSelection(saved.id,current.generation,{limit:1}));
  assert(!JSON.stringify([...f.rows]).includes(input.password));
});
test('disconnect during setup removes credentials; removed destinations invalidate saved sources',async()=>{
  const f=fixture();f.hook(()=>f.epoch('disconnected'));
  await assert.rejects(f.create().connect(owner,input));assert(!JSON.stringify([...f.rows]).includes(input.password));
  f.epoch(owner.epoch);f.hook(()=>{});const saved=await f.create().connect(owner,input),selected=f.create().select(owner,saved.id);
  assert.throws(()=>f.create([]).validate(saved.id,selected.generation));
  const changed=imapServers().map(server=>({...server,host:'changed.example.test'}));
  assert.throws(()=>f.create(changed).validate(saved.id,selected.generation));
  f.epoch('disconnected');assert.throws(()=>f.create().validate(saved.id,selected.generation));
});

test('SMTP is opt-in, tied to the same owner generation, and invalidated by sender configuration changes',async()=>{
 const rows=new Map(),storage={get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value)),delete:key=>rows.delete(key)};
 let checks=0,sends=0;const reader=()=>({checkMailbox:async()=>{},metadata:async()=>({provider:'yandex',query:'folder'}),readSelection:async()=>({provider:'yandex',query:'folder',messages:[],truncated:false})});
 const smtp=(_server,_credential,validate)=>({check:async()=>{checks++;await validate()},send:async()=>{await validate();sends++;return {accepted:true}}});
 const create=(servers=imapServers())=>new ImapAccounts(storage,servers,()=>owner.epoch,reader,smtp);
 const readOnly=await create().connect(owner,input),readSource=create().select(owner,readOnly.id);
 assert.throws(()=>create().validateSender(readOnly.id,readSource.generation));
 create().remove(owner,readOnly.id);
 const setup={...input,smtp:{username:'smtp-owner',password:'smtp-private-password',from:'owner@example.test'}};
 const saved=await create().connect(owner,setup),source=create().select(owner,saved.id);
 assert.equal(checks,1);assert.equal(saved.send_from,setup.smtp.from);assert(!JSON.stringify(saved).includes('password'));
 assert.equal((await create().metadata(saved.id,source.generation)).query,'folder:'+saved.id);
 await create().send(saved.id,source.generation,{to:['recipient@example.test'],subject:'Subject',body:'Body'});assert.equal(sends,1);
 const changed=imapServers().map(server=>({...server,smtp:{...server.smtp,host:'changed.example.test'}}));
 assert.throws(()=>create(changed).validateSender(saved.id,source.generation));
 create(changed).validate(saved.id,source.generation);
 create().remove(owner,saved.id);assert(!JSON.stringify([...rows]).includes('smtp-private-password'));
 await assert.rejects(create().send(saved.id,source.generation,{to:[],subject:'',body:''}));assert.equal(sends,1);
});
