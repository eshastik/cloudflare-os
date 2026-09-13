import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramVoiceTransfer} from './telegram-voice-transfer.ts';
import {TelegramTaskClient} from './telegram-task-client.ts';

async function fixture(){
 const bytes=new TextEncoder().encode('original');const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 const hash=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
 const input={expected_budget_revision:1,update_id:3,message_id:4,sender_id:42,file_unique_id:'file',media_type:'audio/ogg',size_bytes:bytes.length,sha256:hash};
 const budget={revision:1,project_id:'project',policy_revision:1,limit_usd_micros:'500000',voice_binding_id:'voice',voice_limit_usd_micros:'100000'};
 const admission={...input,request_id:'tgv-'+'a'.repeat(64),budget};
 const source={request_id:admission.request_id,project_id:'project',media_type:'audio/ogg',size_bytes:bytes.length,sha256:hash};
 const scope={tenant:'tenant',channel:'channel',owner:'owner',binding:'binding',bot:'123',sender:42,secret:'A'.repeat(43)};
 const values=new Map<string,unknown>();const storage={get:<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,put:<T>(key:string,value:T)=>{values.set(key,structuredClone(value))},delete:(key:string)=>{values.delete(key)}};
 let allowed=true,loseImport=true,puts=0,imports=0,originals=0,ticketOrigin='https://objects.example',alter=false;
 const client=new TelegramTaskClient('https://memory.example',scope,async(url,init)=>{
  if(!allowed)return new Response('',{status:403});
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+scope.secret);
  const path=new URL(String(url)).pathname;
  if(path.endsWith('/voices/settings'))return Response.json(budget);
  if(path.endsWith('/voices')){assert.deepEqual(JSON.parse(String(init?.body)),input);return Response.json({...admission,...(alter?{sender_id:7}:{})});}
  if(path.endsWith('/upload'))return Response.json({upload_id:'upload',url:ticketOrigin+'/original?signature=private',method:'PUT',content_length:bytes.length,checksum_header:'x-amz-checksum-sha256',checksum_value:btoa(String.fromCharCode(...digest))});
  if(path.endsWith('/import')){assert.deepEqual(JSON.parse(String(init?.body)),{upload_id:'upload'});imports++;originals=1;if(loseImport){loseImport=false;return new Response('',{status:503})}return Response.json(source)}
  return Response.json({id:scope.channel,owner_id:scope.owner,binding_id:scope.binding,bot_id:scope.bot,sender_id:scope.sender,revision:1,enabled:true});
 });
 const transfer=()=>new TelegramVoiceTransfer(storage,'https://objects.example','channel:epoch',async(url,init)=>{
  assert.equal(new URL(String(url)).origin,'https://objects.example');assert.equal(new Headers(init?.headers).get('Authorization'),null);assert.equal(init?.redirect,'manual');assert.deepEqual(init?.body,bytes);puts++;return new Response('ok');
 });
 return {input,budget,source,bytes,client,transfer,values,counters:()=>({puts,imports,originals}),revoke:()=>{allowed=false},evilTicket:()=>{ticketOrigin='https://foreign.example'},alter:()=>{alter=true}};
}

test('Scoped voice transfer resumes lost import acknowledgement without another PUT or original',async()=>{
 const f=await fixture();assert.deepEqual(await f.client.voiceSettings(),f.budget);
 await assert.rejects(f.transfer().save(f.client,f.input,f.budget,f.bytes));assert.deepEqual(f.counters(),{puts:1,imports:1,originals:1});
 assert.deepEqual(await f.transfer().resume(f.client,3),f.source);assert.deepEqual(f.counters(),{puts:1,imports:2,originals:1});
 assert.deepEqual(await f.transfer().resume(f.client,3),f.source);assert.equal(f.counters().puts,1);
 const saved=JSON.stringify([...f.values]);assert.doesNotMatch(saved,/signature|https:|Authorization|AAAAAAAAAAAAAAAA/);
 await assert.rejects(f.transfer().save(f.client,{...f.input,file_unique_id:'other'},f.budget,f.bytes));
 await assert.rejects(f.transfer().save(f.client,f.input,{...f.budget,project_id:'other'},f.bytes));
 f.revoke();await assert.rejects(f.transfer().resume(f.client,3));
});

test('Changed bytes, admission scope and foreign upload ticket fail before transferring audio',async()=>{
 for(const mode of ['bytes','admission','origin']){
  const f=await fixture();if(mode==='admission')f.alter();if(mode==='origin')f.evilTicket();
  await assert.rejects(f.transfer().save(f.client,f.input,f.budget,mode==='bytes'?new Uint8Array(f.bytes.length):f.bytes));
  assert.deepEqual(f.counters(),{puts:0,imports:0,originals:0});
 }
});
