import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramTaskClient} from './telegram-task-client.ts';

const scope = {tenant:'tenant',channel:'channel',owner:'owner',binding:'binding',bot:'123',sender:42,secret:'A'.repeat(43)};
const source = {update_id:1,message_id:2,sender_id:42,message:'task',criteria:'criteria'};
const grant = {id:'channel',owner_id:'owner',binding_id:'binding',bot_id:'123',sender_id:42,revision:1,enabled:true};
const result = {update_id:1,request_id:'request',outcome:{request_id:'request',state:'completed',result:{content:'answer'}}};
test('Dedicated task client freezes scope/source and separates submit, read and authorization',async()=>{
 const sent: {url:string;method:string|undefined;body:unknown}[]=[];
 const selected={...scope};
 const client=new TelegramTaskClient('https://memory.example',selected,async(url,init)=>{
  assert.equal(init?.redirect,'manual');assert.ok(init?.signal);
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+scope.secret);
  sent.push({url:String(url),method:init?.method,body:init?.body?JSON.parse(String(init.body)):null});
  return Response.json(String(url).endsWith('/channel')?grant:result);
 });
 selected.secret='B'.repeat(43);selected.channel='other';
 await client.validate();
 const mutable={...source},pending=client.submit(mutable);mutable.message='changed';
 assert.deepEqual(await pending,result);assert.deepEqual(await client.read(1,'request'),result);
 assert.deepEqual(sent,[
  {url:'https://memory.example/v1/telegram-channel-access/tenant/channel',method:'GET',body:null},
  {url:'https://memory.example/v1/telegram-channel-access/tenant/channel/tasks',method:'POST',body:source},
  {url:'https://memory.example/v1/telegram-channel-access/tenant/channel/tasks/1',method:'GET',body:null},
 ]);
 await assert.rejects(client.read(1,'other'),e=>(e as {status:number}).status===502);
 const count=sent.length;await assert.rejects(client.submit({...source,sender_id:99}));assert.equal(sent.length,count);
});
test('Dedicated task client rejects changed grant or result and strips credential-bearing errors',async()=>{
 for(const changed of [{...grant,owner_id:'peer'},{...grant,binding_id:'foreign'},{...grant,sender_id:99},{...grant,enabled:false},null]){
  const client=new TelegramTaskClient('https://memory.example',scope,async()=>Response.json(changed));
  await assert.rejects(client.validate(),e=>(e as {status:number}).status===403);
 }
 for(const changed of [{...result,update_id:2},{...result,outcome:{...result.outcome,request_id:'foreign'}},{...result,outcome:{...result.outcome,result:null}},{...result,outcome:{...result.outcome,receipt_present:false}},null]){
  const client=new TelegramTaskClient('https://memory.example',scope,async()=>Response.json(changed));
  await assert.rejects(client.read(1),e=>(e as {status:number}).status===502);
 }
 for(const mode of ['secret-error','oversize','redirect','revoked']){
  const client=new TelegramTaskClient('https://memory.example',scope,async()=>{
   if(mode==='secret-error')throw Error('Bearer '+scope.secret);
   if(mode==='oversize')return new Response('x'.repeat(4*1024*1024+1));
   return new Response(null,{status:mode==='redirect'?302:403});
  });
  await assert.rejects(client.read(1),(error:Error)=>{assert.equal(error.message.includes(scope.secret),false);assert.equal(error.cause,undefined);return true;});
 }
});

test('Credential cleanup uses fixed revoke without active grant validation',async()=>{
 let calls=0;
 const client=new TelegramTaskClient('https://memory.example',scope,async(url,init)=>{
  calls++;assert.equal(String(url),'https://memory.example/v1/telegram-channel-access/tenant/channel/revoke');
  assert.equal(init?.method,'POST');assert.equal(init?.body,'{}');return Response.json({disabled:true});
 });
 await client.revoke();await client.revoke();assert.equal(calls,2);
 const invalid=new TelegramTaskClient('https://memory.example',scope,async()=>Response.json({disabled:false}));
 await assert.rejects(invalid.revoke());
});
test('Correction pins source/parent and distinguishes confirmed closed admission from unknown failure',async()=>{
 const input={update_id:3,message_id:4,sender_id:42,target_update_id:1,message:'correction'};
 let mode='ok';const calls:unknown[]=[];
 const client=new TelegramTaskClient('https://memory.example',scope,async(url,init)=>{
  assert.equal(String(url),'https://memory.example/v1/telegram-channel-access/tenant/channel/corrections');calls.push(JSON.parse(String(init?.body)));
  if(mode==='closed')return Response.json({code:'telegram.correction_closed'},{status:409});
  if(mode==='unknown')return Response.json({code:'telegram.unconfirmed'},{status:503});
  return Response.json({update_id:3,target_update_id:mode==='changed'?99:1,outcome:{request_id:'request',correction_id:'change',sequence:1,journalled:false,secret:'omit'}});
 });
 const mutable={...input},pending=client.correct(mutable,'request');mutable.message='changed';
 const out=await pending;assert.deepEqual(calls[0],input);assert.equal(JSON.stringify(out).includes('omit'),false);
 mode='changed';await assert.rejects(client.correct(input),e=>(e as {status:number}).status===502);
 mode='closed';await assert.rejects(client.correct(input),e=>e.constructor.name==='TelegramCorrectionClosed');
 mode='unknown';await assert.rejects(client.correct(input),e=>(e as {status:number}).status===503);
});

test('Budget metadata is scoped to the exact source and remains separate from a runtime receipt',async()=>{
 const budget={update_id:1,request_id:'request',budget_revision:2,project_id:'project',proposal_id:'proposal',state:'awaiting_approval'};
 let change=(x:Record<string,unknown>)=>x;
 const client=new TelegramTaskClient('https://memory.example',scope,async()=>Response.json({...result,outcome:{request_id:'request',state:'unconfirmed',result:null},budget:change({...budget,secret:'hidden'})}));
 const out=await client.submit(source);assert.deepEqual(out.budget,budget);assert.equal(out.outcome.receipt_present,undefined);
 for(const [key,value] of [['update_id',2],['request_id','foreign'],['budget_revision',0],['state','running']]){
  change=x=>({...x,[String(key)]:value});await assert.rejects(client.read(1),e=>(e as {status:number}).status===502);
 }
});

test('Voice recognition response pins source, project, transcriber and saved unconfirmed version',async()=>{
 const expected={request:'original',project:'project',binding:'voice',budgetRevision:2};
 const transcript={source_request_id:'original',revision:1,operation_id:'operation',kind:'provider',text:'A spoken task',provider:'fixture',model_id:'fixture',provider_request_id:'provider',uncertain:true};
 const result={update_id:3,source_request_id:'original',project_id:'project',proposal_id:'proposal',binding_id:'voice',budget_revision:2,state:'completed',transcript};
 let alter=(x:typeof result)=>x;
 const client=new TelegramTaskClient('https://memory.example',scope,async(url,init)=>{assert.ok(String(url).endsWith('/voices/3/transcribe'));assert.deepEqual(JSON.parse(String(init?.body)),{});return Response.json(alter(result));});
 assert.deepEqual((await client.transcribeVoice(3,expected)).transcript,transcript);
 for(const [key,value] of Object.entries({source_request_id:'foreign',project_id:'foreign',binding_id:'foreign',budget_revision:3,update_id:4})){
  alter=x=>({...x,[key]:value});await assert.rejects(client.transcribeVoice(3,expected));
 }
 alter=x=>({...x,transcript:{...x.transcript,uncertain:false}});await assert.rejects(client.transcribeVoice(3,expected));
});

test('Voice review client pins source, operation, revision and digest and accepts historical receipt',async()=>{
 const receipt={source_request_id:'original',operation_id:'telegram-review-4',revision:1,text_sha256:'b'.repeat(64),current:false};
 let response={...receipt};
 const client=new TelegramTaskClient('https://memory.example',scope,async(url,init)=>{
  assert.ok(String(url).endsWith('/voices/2/confirm'));
  assert.deepEqual(JSON.parse(String(init?.body)),{update_id:4,sender_id:42,revision:1,text_sha256:receipt.text_sha256,confirmed:true});
  return Response.json(response);
 });
 assert.deepEqual(await client.confirmVoice(2,4,1,receipt.text_sha256,'original'),receipt);
 for(const bad of [{source_request_id:'foreign'},{operation_id:'other'},{revision:2},{text_sha256:'c'.repeat(64)}]){
  response={...receipt,...bad};await assert.rejects(client.confirmVoice(2,4,1,receipt.text_sha256,'original'));
 }
});

test('Voice edit response must preserve exact human text, operation and new revision',async()=>{
 const transcript={source_request_id:'original',operation_id:'telegram-edit-4',revision:2,kind:'human',text:'Monday',provider:'',model_id:'',provider_request_id:'',uncertain:true};let response={...transcript};
 const client=new TelegramTaskClient('https://memory.example',scope,async(url,init)=>{
  assert.ok(String(url).endsWith('/voices/2/edit'));assert.deepEqual(JSON.parse(String(init?.body)),{update_id:4,sender_id:42,expected_revision:1,text:'Monday'});return Response.json(response);
 });
 assert.deepEqual(await client.editVoice(2,4,1,'Monday','original'),transcript);
 for(const bad of [{text:'Tuesday'},{source_request_id:'foreign'},{revision:3},{operation_id:'other'},{uncertain:false},{kind:'provider'}]){response={...transcript,...bad};await assert.rejects(client.editVoice(2,4,1,'Monday','original'));}
});

test('Voice command client pins review, budget and executor and validates runtime identity across retries',async()=>{
 const review={source_request_id:'original',operation_id:'telegram-review-3',revision:1,text_sha256:'a'.repeat(64),current:true};
 const waiting={source_request_id:'original',confirmation_id:review.operation_id,project_id:'project',binding_id:scope.binding,budget_revision:2,proposal_id:'proposal',state:'awaiting_approval'};
 let response:unknown=waiting;
 const client=new TelegramTaskClient('https://memory.example',scope,async(url,init)=>{assert.ok(String(url).endsWith('/voices/1/run'));assert.deepEqual(JSON.parse(String(init?.body)),{sender_id:42,confirmation_update_id:3,revision:1,text_sha256:review.text_sha256,confirmed:true});return Response.json(response);});
 const expected={project:'project',budgetRevision:2};const wait=await client.runVoice(1,review,expected);assert.deepEqual(wait,waiting);
 response={...waiting,state:'completed',outcome:{request_id:'runtime',state:'completed',result:{content:'done'}}};const done=await client.runVoice(1,review,expected,wait);assert.equal(done.outcome?.result?.content,'done');
 for(const bad of [{source_request_id:'foreign'},{confirmation_id:'other'},{project_id:'foreign'},{binding_id:'foreign'},{budget_revision:3},{proposal_id:'other'},{outcome:{request_id:'another',state:'completed',result:{content:'done'}}}]){response={...done,...bad};await assert.rejects(client.runVoice(1,review,expected,done));}
});
