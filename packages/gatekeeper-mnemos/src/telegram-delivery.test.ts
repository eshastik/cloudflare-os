import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramDelivery,telegramDeliveryStates,telegramLocalInbox,compactTelegramLocalText} from './telegram-delivery.ts';
import {TelegramTaskError, TelegramCorrectionClosed, type TelegramCorrectionSource, type TelegramCorrectionReply, type TelegramTaskReply, type TelegramTaskSource} from './telegram-task-client.ts';

function fixture(){
  const values=new Map<string,unknown>(),submitted:TelegramTaskSource[]=[],reads:number[]=[],sent:string[]=[],alarms:number[]=[];
  const outcomes=new Map<number,TelegramTaskReply>();
  let now=1000,allowed=true,loseSubmit=false,loseSend=false,loseArm=false,revokeAfterRun=false,executions=0;
  const storage={get:<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,
    put:<T>(key:string,value:T)=>{values.set(key,structuredClone(value));},delete:(key:string)=>{values.delete(key);},
    list:<T>({prefix,limit=10000,startAfter}:{prefix:string;limit?:number;startAfter?:string})=>[...values].filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([key,value])=>[key,structuredClone(value)] as [string,T])};
  const ports={now:()=>now,authorize:async()=>{if(!allowed)throw new TelegramTaskError(403);},arm:async(at:number)=>{if(loseArm){loseArm=false;throw Error('alarm unavailable');}alarms.push(at);},
    send:async(text:string)=>{sent.push(text);if(loseSend){loseSend=false;throw Error('send acknowledgement lost');}return sent.length;},
    client:{correct:async(_source:TelegramCorrectionSource,_expected?:string):Promise<TelegramCorrectionReply>=>{throw new TelegramTaskError(409);},submit:async(source:TelegramTaskSource,expected?:string)=>{
      submitted.push(structuredClone(source));let result=outcomes.get(source.update_id);
      if(!result){executions++;result={update_id:source.update_id,request_id:'request-'+source.update_id,outcome:{request_id:'request-'+source.update_id,state:'completed',result:{content:'answer'}}};outcomes.set(source.update_id,result);}
      if(expected)assert.equal(result.request_id,expected);
      if(revokeAfterRun)allowed=false;
      if(loseSubmit){loseSubmit=false;throw new TelegramTaskError(503);}return structuredClone(result);
    },read:async(update:number,expected?:string)=>{reads.push(update);const result=outcomes.get(update);if(!result)throw new TelegramTaskError(409);if(expected)assert.equal(result.request_id,expected);return structuredClone(result);}},
  };
  return {storage,ports,values,submitted,reads,sent,alarms,outcomes,queue:()=>new TelegramDelivery(storage,'channel',42,ports),
    elapse:(ms:number)=>{now+=ms;},advance:()=>{now=alarms.at(-1)??now;},setLoseSubmit:()=>{loseSubmit=true;},setLoseSend:()=>{loseSend=true;},setLoseArm:()=>{loseArm=true;},revokeAfterRun:()=>{revokeAfterRun=true;},executions:()=>executions};
}
const message={update:1,message:2,sender:42,text:'Проверь задачу'};
test('Durable queue arms before ACK and converges after lost submit, restart and duplicate webhook',async()=>{
  const f=fixture();let q=f.queue();f.setLoseArm();
  await assert.rejects(q.enqueue(message));assert.equal(f.submitted.length,0);
  await q.enqueue(message);assert.equal(f.alarms.length,1);
  f.setLoseSubmit();await q.drain();assert.equal(f.executions(),1);assert.equal(f.sent.length,0);
  q=f.queue();f.advance();await q.drain();assert.equal(f.executions(),1);assert.equal(f.sent.length,1);
  assert.deepEqual(f.submitted[0],f.submitted[1]);
  await q.enqueue(message);await f.queue().drain();assert.equal(f.sent.length,1);
  await assert.rejects(q.enqueue({...message,text:'Подмена'}),error=>(error as TelegramTaskError).status===409);
});
test('Uncertain send is never automatically repeated; explicit status reads without launching a task',async()=>{
  const f=fixture();const q=f.queue();await q.enqueue(message);f.setLoseSend();await q.drain();
  assert.equal(f.sent.length,1);
  const job=[...f.values].find(([key])=>key.includes(':job:'))?.[1] as {delivery:Record<string,string>};
  assert.equal(job.delivery.completed,'uncertain');
  await f.queue().enqueue(message);await f.queue().drain();assert.equal(f.sent.length,1);
  await q.enqueue({update:3,message:4,sender:42,text:'/status'});await q.drain();
  assert.equal(f.executions(),1);assert.equal(f.submitted.length,1);assert.deepEqual(f.reads,[1]);assert.equal(f.sent.length,2);
});
test('Unconfirmed task is polled and final reply follows once; revocation withholds content',async()=>{
  const f=fixture();let q=f.queue();
  f.outcomes.set(1,{update_id:1,request_id:'request-1',outcome:{request_id:'request-1',state:'unconfirmed',result:null}});
  await q.enqueue(message);await q.drain();assert.equal(f.sent.length,1);assert.match(f.sent[0],/не подтверждён/);
  f.outcomes.set(1,{update_id:1,request_id:'request-1',outcome:{request_id:'request-1',state:'completed',result:{content:'finished'}}});
  q=f.queue();f.advance();await q.drain();assert.deepEqual(f.reads,[1]);assert.equal(f.submitted.length,1);assert.equal(f.sent.length,2);assert.match(f.sent[1],/finished/);
  const revoked=fixture();revoked.revokeAfterRun();const r=revoked.queue();await r.enqueue(message);await r.drain();assert.equal(revoked.sent.length,0);
});
test('Restart at the send checkpoint preserves uncertainty and never resends the answer',async()=>{
  const f=fixture(),q=f.queue();await q.enqueue(message);await q.drain();assert.equal(f.sent.length,1);
  const [key,value]=[...f.values].find(([key])=>key.includes(':job:'))!;
  const job=structuredClone(value) as {state:string;delivery:Record<string,string>};
  // This is the durable state if Telegram accepted the send and the Worker died
  // before persisting the acknowledgement; it must not be interpreted as unsent.
  job.state='pending';job.delivery.completed='sending';f.values.set(key,job);
  f.values.set(key.replace(':job:',':pending:'),{update:1,at:1000});
  await f.queue().drain();assert.equal(f.sent.length,1);
  assert.equal((f.values.get(key) as typeof job).delivery.completed,'uncertain');
});
test('Concurrent admission and pending quota preserve existing receipts and status for queued work',async()=>{
  const f=fixture(),q=f.queue();await Promise.all([q.enqueue(message),q.enqueue(message)]);
  assert.equal([...f.values.keys()].filter(key=>key.includes(':pending:')).length,1);
  for(let update=2;update<=100;update++)await q.enqueue({update,message:update+1000,sender:42,text:'task'});
  await assert.rejects(q.enqueue({update:101,message:1101,sender:42,text:'task'}),error=>(error as TelegramTaskError).status===503);
  await q.enqueue(message);assert.equal(f.submitted.length,0);
  const g=fixture(),other=g.queue();await other.enqueue(message);g.setLoseSubmit();await other.drain();
  await other.enqueue({update:3,message:4,sender:42,text:'/status'});await other.drain();
  assert.equal(g.submitted.length,1);assert.equal(g.reads.length,0);assert.match(g.sent[0],/в очереди/);
});
test('Corrections reach a running task independently and freeze their parent across replay and restart',async()=>{
 const f=fixture();let release!:()=>void,started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
 const submit=f.ports.client.submit;f.ports.client.submit=async(...args)=>{started();await waiting;return submit(...args);};
 const corrections:TelegramCorrectionSource[]=[];let lose=true;
 f.ports.client.correct=async source=>{corrections.push({...source});if(lose){lose=false;throw new TelegramTaskError(503);}return {update_id:source.update_id,target_update_id:source.target_update_id,outcome:{request_id:'request-1',correction_id:'saved-change',sequence:1,journalled:false}};};
 let q=f.queue();await q.enqueue(message);const running=q.drain();await entered;
 const correction={update:3,message:4,sender:42,text:'Уточни срок',replyTo:2};
 await q.enqueue(correction);await q.drain(true);assert.equal(corrections.length,1);assert.equal(corrections[0].target_update_id,1);assert.equal(f.submitted.length,0,'original HTTP still waiting');
 // Local durable state survives eviction; the same source retries independently.
 q=f.queue();f.advance();await q.drain(true);assert.deepEqual(corrections[0],corrections[1]);assert.equal(f.sent.length,1);assert.match(f.sent[0],/Корректировка.*принята/);
 await q.enqueue({...message,update:5,message:6,text:'Different task'});
 await q.enqueue(correction);await q.drain(true);assert.equal(corrections.length,2,'duplicate must not reselect latest task');
 release();await running;
 assert.equal(f.executions(),1);assert.equal(f.submitted.length,1);
});
test('Closed correction and unknown reply never launch a task; lost send is not repeated',async()=>{
 const f=fixture(),q=f.queue();await q.enqueue(message);await q.drain();
 f.ports.client.correct=async()=>{throw new TelegramCorrectionClosed();};
 await q.enqueue({update:3,message:4,sender:42,text:'/correct 1 revise'});await q.drain(true);
 assert.match(f.sent.at(-1)!,/больше не принимает/);assert.equal(f.executions(),1);
 await q.enqueue({update:5,message:6,sender:42,text:'Unknown reply',replyTo:999});await q.drain();assert.equal(f.executions(),1);assert.match(f.sent.at(-1)!,/не принято/);
 let calls=0;
 f.ports.client.correct=async source=>{calls++;return {update_id:source.update_id,target_update_id:1,outcome:{request_id:'request-1',correction_id:'change',sequence:1,journalled:true}};};
 f.setLoseSend();await q.enqueue({update:7,message:8,sender:42,text:'/correct 1 again'});await q.drain(true);
 const sent=f.sent.length;await f.queue().drain(true);assert.equal(f.sent.length,sent);assert.equal(calls,1);
});

test('Human observations expose last result and uncertain delivery without mutating or resending',async()=>{
 const f=fixture(),q=f.queue();f.setLoseSend();await q.enqueue(message);await q.drain();
 const before=JSON.stringify([...f.values]);const calls=f.sent.length;
 const states=telegramDeliveryStates(f.storage,'channel',[1,99]);
 assert.deepEqual(states,[{update_id:1,request_id:'request-1',queue:'done',execution:'completed',correction:null,delivery:[{phase:'completed',state:'uncertain'}]}]);
 assert.equal(JSON.stringify([...f.values]),before);assert.equal(f.sent.length,calls);assert.equal(JSON.stringify(states).includes(message.text),false);
 assert.deepEqual(telegramDeliveryStates(f.storage,'another-channel',[1]),[]);
});

test('Local journal shows pre-API inputs and paginates without executing or changing receipts',async()=>{
 const f=fixture(),q=f.queue();
 for(let i=0;i<30;i++)await q.enqueue({update:i,message:i+1,sender:42,text:'message '+i});
 const before=JSON.stringify([...f.values]);
 const page=telegramLocalInbox(f.storage,'channel',-1);assert.equal(page.items.length,25);assert.equal(page.next_after,24);assert.equal(page.items[0].state.queue,'pending');assert.equal(page.items[0].state.request_id,null);
 const rest=telegramLocalInbox(f.storage,'channel',page.next_after!);assert.equal(rest.items.length,5);assert.equal(rest.items[0].update_id,25);assert.equal(rest.next_after,null);
 assert.equal(f.executions(),0);assert.equal(f.sent.length,0);assert.equal(JSON.stringify([...f.values]),before);
});

test('Budget wait survives restart; only approved missing receipt submits, rejected tasks stop polling',async()=>{
 const f=fixture();let runs=0;
 const budget={update_id:1,request_id:'request-1',budget_revision:2,project_id:'project',proposal_id:'proposal',state:'awaiting_approval' as const};
 const waiting:TelegramTaskReply={update_id:1,request_id:'request-1',budget,outcome:{request_id:'request-1',state:'unconfirmed',result:null}};
 f.outcomes.set(1,waiting);
 const submit=f.ports.client.submit;
 f.ports.client.submit=async(source,expected)=>{
  if(f.outcomes.get(1)?.budget?.state==='approved'){runs++;f.outcomes.set(1,{...waiting,budget:{...budget,state:'approved'},outcome:{request_id:'request-1',state:'completed',result:{content:'approved answer'}}});}
  return submit(source,expected);
 };
 await f.queue().enqueue(message);await f.queue().drain();assert.equal(runs,0);assert.match(f.sent[0],/ожидает согласования/);
 assert.equal(telegramDeliveryStates(f.storage,'channel',[1])[0].budget?.state,'awaiting_approval');
 f.advance();await f.queue().drain();assert.equal(f.submitted.length,1);assert.equal(f.sent.length,1);
 f.outcomes.set(1,{...waiting,budget:{...budget,state:'approved'},outcome:{...waiting.outcome,receipt_present:false}});
 f.advance();await f.queue().drain();assert.equal(runs,1);assert.equal(f.submitted.length,2);assert.match(f.sent.at(-1)!,/approved answer/);
 const denied=fixture();denied.outcomes.set(1,{...waiting,budget:{...budget,state:'rejected'}});
 await denied.queue().enqueue(message);await denied.queue().drain();assert.match(denied.sent[0],/Автоматического запуска не будет/);
 denied.advance();await denied.queue().drain();assert.equal(denied.reads.length,0);assert.equal(denied.submitted.length,1);
});


test('Terminal local text expires without replaying deliveries or losing source identity',async()=>{
 const f=fixture();let q=f.queue();await q.enqueue(message);f.setLoseSend();await q.drain();
 f.elapse(31*24*60*60*1000);q=f.queue();await q.drain();
 const page=telegramLocalInbox(f.storage,'channel',-1);
 assert.equal(page.items[0].content_expired,true);assert.equal(page.items[0].message,'');
 assert.equal(page.items[0].state.delivery[0].state,'uncertain');
 await q.enqueue(message);await q.drain();assert.equal(f.sent.length,1);assert.equal(f.executions(),1);
 await assert.rejects(q.enqueue({...message,text:'different'}),error=>(error as TelegramTaskError).status===409);
 await q.enqueue({update:3,message:4,sender:42,text:'/status 1'});await q.drain();
 assert.equal(f.executions(),1);assert.equal(f.sent.length,2);assert.match(f.sent[1],/answer/);
});

test('Retention leaves pending inputs intact and gives legacy terminal rows a full retention period',async()=>{
 const f=fixture();const q=f.queue();await q.enqueue(message);await q.drain();
 const key=[...f.values.keys()].find(key=>key.includes(':job:'))!;
 const legacy=f.values.get(key) as {finishedAt?:number};delete legacy.finishedAt;
 await q.enqueue({update:3,message:4,sender:42,text:'still waiting'});
 f.elapse(31*24*60*60*1000);await q.drain(true);
 let page=telegramLocalInbox(f.storage,'channel',-1);
 assert.equal(page.items[0].message,message.text);assert.equal(page.items[1].message,'still waiting');
 f.elapse(31*24*60*60*1000);await f.queue().drain(true);
 page=telegramLocalInbox(f.storage,'channel',-1);
 assert.equal(page.items[0].content_expired,true);assert.equal(page.items[1].message,'still waiting');
 assert.equal(page.items[1].state.queue,'pending');
});


test('Global compaction crosses batch boundaries and old channels without changing pending work',async()=>{
 const f=fixture();const q=f.queue();await q.enqueue(message);await q.drain();
 const original=f.values.get('telegramDelivery:channel:job:0000000000000001');
 for(let i=0;i<205;i++)f.values.set('telegramDelivery:old-channel:job:'+String(i).padStart(16,'0'),structuredClone(original));
 f.elapse(31*24*60*60*1000);
 for(let i=0;i<4;i++){compactTelegramLocalText(f.storage,f.ports.now());f.elapse(1001);}
 const old=[...f.values].filter(([key])=>key.startsWith('telegramDelivery:old-channel:job:'));
 assert.equal(old.length,205);assert.ok(old.every(([,value])=>(value as {compacted?:boolean}).compacted));
 assert.equal(f.executions(),1);assert.equal(f.sent.length,1);
});

test('Voice receipt survives alarm failure and restart without launching or replacing a task',async()=>{
 const f=fixture();await f.queue().enqueue(message);await f.queue().drain();
 const voice={update:2,message:3,sender:42,request:'original-voice'};
 f.setLoseArm();await assert.rejects(f.queue().enqueueVoiceReceipt(voice));
 await f.queue().enqueueVoiceReceipt(voice);await f.queue().drain();
 assert.equal(f.executions(),1);assert.equal(f.sent.length,2);
 assert.match(f.sent[1],/Автоматическое распознавание пока не включено/);
 assert.match(f.sent[1],/original-voice/);
 assert.equal(f.values.get('telegramDelivery:channel:latest'),1);
 await f.queue().enqueueVoiceReceipt(voice);await f.queue().drain();assert.equal(f.sent.length,2);
 await assert.rejects(f.queue().enqueueVoiceReceipt({...voice,request:'another'}));
 await assert.rejects(f.queue().enqueueVoiceReceipt({...voice,sender:7}));
 await assert.rejects(f.queue().enqueue({...message,update:2,text:'Голосовое сообщение: original-voice'}));
 const local=telegramLocalInbox(f.storage,'channel',-1).items[1];
 assert.equal(local.kind,'voice');assert.equal(local.state.execution,null);
 assert.deepEqual(local.state.delivery,[{phase:'voice',state:'delivered'}]);
 await f.queue().enqueue({...message,update:3,text:'/status 2'});await f.queue().drain();
 assert.equal(f.executions(),1);assert.equal(f.reads.length,0);assert.match(f.sent[2],/original-voice/);
});

test('Voice receipt with lost delivery acknowledgement is not resent; revoked channel sends nothing',async()=>{
 const f=fixture(),voice={update:2,message:3,sender:42,request:'original-voice'};
 await f.queue().enqueueVoiceReceipt(voice);f.setLoseSend();await f.queue().drain();
 await f.queue().enqueueVoiceReceipt(voice);await f.queue().drain();
 assert.equal(f.sent.length,1);assert.equal(f.executions(),0);
 assert.deepEqual(telegramDeliveryStates(f.storage,'channel',[2])[0].delivery,[{phase:'voice',state:'uncertain'}]);
 await f.queue().enqueueVoiceReceipt({...voice,update:3,message:4});
 f.ports.authorize=async()=>{throw new TelegramTaskError(403);};await f.queue().drain();
 assert.equal(f.sent.length,1);assert.equal(telegramDeliveryStates(f.storage,'channel',[3])[0].queue,'blocked');
});

test('Voice budget waiting resumes, delivers unconfirmed transcript once and status never runs recognition',async()=>{
 const f=fixture();let completed=false,calls=0;
 Object.assign(f.ports,{voice:async(update:number)=>{calls++;return {request:'original',project:'project',sha256:'a'.repeat(64),recognition:{update_id:update,source_request_id:'original',project_id:'project',proposal_id:'voice-budget',binding_id:'voice',budget_revision:1,state:completed?'completed':'awaiting_approval',...(completed?{transcript:{source_request_id:'original',revision:1,operation_id:'op',kind:'provider',text:'Sensitive spoken task',provider:'fixture',model_id:'fixture',provider_request_id:'provider',uncertain:true}}:{})}}}});
 const voice={update:2,message:3,sender:42,request:'local-request'};
 await f.queue().enqueueVoiceReceipt(voice);await f.queue().drain();
 assert.match(f.sent[0],/ждёт согласования бюджета/);assert.equal(telegramDeliveryStates(f.storage,'channel',[2])[0].queue,'pending');
 completed=true;f.elapse(15000);await f.queue().drain();assert.equal(calls,2);assert.equal(f.executions(),0);
 assert.match(f.sent[1],/Sensitive spoken task/);assert.match(f.sent[1],/Из голосового сообщения я понял/);
 assert.equal(telegramDeliveryStates(f.storage,'channel',[2])[0].voice?.state,'completed');
 await f.queue().enqueueVoiceReceipt(voice);await f.queue().drain();assert.equal(calls,2);assert.equal(f.sent.length,2);
 await f.queue().enqueue({...message,update:3,text:'/status 2'});await f.queue().drain();assert.equal(calls,2);assert.equal(f.reads.length,0);assert.match(f.sent[2],/Sensitive spoken task/);
 compactTelegramLocalText(f.storage,31*24*60*60*1000);assert.doesNotMatch(JSON.stringify([...f.values]),/Sensitive spoken task/);
});

test('Explicit voice confirmation pins displayed text, survives restart and never submits an agent task',async()=>{
 const f=fixture();let reviews=0,lose=true;
 Object.assign(f.ports,{voice:async()=>({request:'original',project:'project',sha256:'a'.repeat(64),recognition:{update_id:2,source_request_id:'original',project_id:'project',proposal_id:'budget',binding_id:'voice',budget_revision:1,state:'completed',transcript:{source_request_id:'original',revision:1,operation_id:'op',kind:'provider',text:'Встреча в пятницу.',provider:'fixture',model_id:'fixture',provider_request_id:'provider',uncertain:true}}})});
 Object.assign(f.ports.client,{confirmVoice:async(target:number,update:number,revision:number,hash:string,source:string)=>{
  reviews++;assert.equal(target,2);assert.equal(update,4);assert.equal(revision,1);assert.equal(source,'original');
  if(lose){lose=false;throw new TelegramTaskError(503);}
  return {source_request_id:source,operation_id:'telegram-review-'+update,revision,text_sha256:hash,current:true};
 }});
 await f.queue().enqueueVoiceReceipt({update:2,message:3,sender:42,request:'local'});await f.queue().drain();
 const command=f.sent[0].match(/\/voice_execute 2 1 [a-f0-9]{64}/)?.[0]?.replace('/voice_execute','/voice_confirm');assert.ok(command);
 await f.queue().enqueue({...message,update:3,text:command.replace(' 1 ',' 2 ')});await f.queue().drain();assert.equal(reviews,0);assert.match(f.sent.at(-1)!,/не принято/);
 const confirm={...message,update:4,message:5,text:command};
 await f.queue().enqueue(confirm);await f.queue().drain();assert.equal(reviews,1);
 f.advance();await f.queue().drain();assert.equal(reviews,2);assert.match(f.sent.at(-1)!,/Текст версии 1 подтверждён/);
 await f.queue().enqueue(confirm);await f.queue().drain();assert.equal(reviews,2);
 await f.queue().enqueue({...message,update:5,text:'/status 4'});await f.queue().drain();assert.equal(reviews,2);assert.match(f.sent.at(-1)!,/подтверждён/);
 assert.equal(f.executions(),0);assert.equal(f.reads.length,0);
});

test('Truncated voice text cannot supply an in-chat confirmation command',async()=>{
 const f=fixture();Object.assign(f.ports,{voice:async()=>({request:'original',project:'project',sha256:'a'.repeat(64),recognition:{state:'completed',source_request_id:'original',project_id:'project',transcript:{revision:1,text:'я'.repeat(1401)}}})});
 await f.queue().enqueueVoiceReceipt({update:2,message:3,sender:42,request:'local'});await f.queue().drain();
 assert.match(f.sent[0],/Текст сокращён/);assert.doesNotMatch(f.sent[0],/\/voice_confirm/);assert.equal(f.executions(),0);
});

test('Voice edits are immutable retries; confirmation uses the corrected version, never the provider text',async()=>{
 const f=fixture();let edits=0,confirms=0,lose=true;
 Object.assign(f.ports,{voice:async()=>({request:'original',project:'project',sha256:'a'.repeat(64),recognition:{state:'completed',source_request_id:'original',project_id:'project',transcript:{revision:1,text:'Friday'}}})});
 Object.assign(f.ports.client,{editVoice:async(target:number,update:number,revision:number,text:string,source:string)=>{
  edits++;assert.equal(target,2);assert.equal(update,3);assert.equal(revision,1);assert.equal(text,'Monday');assert.equal(source,'original');
  if(lose){lose=false;throw new TelegramTaskError(503);}
  return {source_request_id:source,revision:2,operation_id:'telegram-edit-3',kind:'human',text,provider:'',model_id:'',provider_request_id:'',uncertain:true};
 },confirmVoice:async(target:number,update:number,revision:number,hash:string,source:string)=>{
  confirms++;assert.equal(target,2);assert.equal(revision,2);return {source_request_id:source,operation_id:'telegram-review-'+update,revision,text_sha256:hash,current:true};
 }});
 await f.queue().enqueueVoiceReceipt({update:2,message:3,sender:42,request:'local'});await f.queue().drain();
 const oldCommand=f.sent[0].match(/\/voice_execute 2 1 [a-f0-9]{64}/)![0].replace('/voice_execute','/voice_confirm');
 const edit={...message,update:3,text:'/voice_edit 2 1 Monday'};
 await f.queue().enqueue(edit);await f.queue().drain();f.advance();await f.queue().drain();
 assert.equal(edits,2);assert.match(f.sent.at(-1)!,/Поручение уточнено/);assert.match(f.sent.at(-1)!,/Monday/);
 const newCommand=f.sent.at(-1)!.match(/\/voice_execute 2 2 [a-f0-9]{64}/)![0].replace('/voice_execute','/voice_confirm');
 await f.queue().enqueue(edit);await f.queue().drain();assert.equal(edits,2);
 await f.queue().enqueue({...message,update:4,text:oldCommand});await f.queue().drain();assert.equal(confirms,0);assert.match(f.sent.at(-1)!,/не принято/);
 await f.queue().enqueue({...message,update:5,text:'/status 2'});await f.queue().drain();assert.match(f.sent.at(-1)!,/Monday/);assert.doesNotMatch(f.sent.at(-1)!,/Friday/);
 await f.queue().enqueue({...message,update:6,text:newCommand});await f.queue().drain();assert.equal(confirms,1);
 await f.queue().enqueue({...message,update:7,text:'/voice_edit 2 1 Tuesday'});await f.queue().drain();assert.equal(edits,2);
 assert.equal(f.executions(),0);assert.equal(f.reads.length,0);
 compactTelegramLocalText(f.storage,31*24*60*60*1000);assert.doesNotMatch(JSON.stringify([...f.values]),/Monday|Friday/);
});

test('Reviewed voice command waits for its budget, resumes after restart, and status never runs it',async()=>{
 const f=fixture();let runs=0,approved=false;
 Object.assign(f.ports,{voice:async()=>({request:'original',project:'project',sha256:'a'.repeat(64),recognition:{state:'completed',source_request_id:'original',project_id:'project',budget_revision:3,transcript:{revision:1,text:'Prepare report'}}})});
 Object.assign(f.ports.client,{confirmVoice:async(target:number,update:number,revision:number,hash:string,source:string)=>({source_request_id:source,operation_id:'telegram-review-'+update,revision,text_sha256:hash,current:true}),runVoice:async(target:number,review:{operation_id:string;revision:number},expected:{project:string;budgetRevision:number})=>{
  runs++;assert.equal(target,2);assert.equal(review.operation_id,'telegram-review-3');assert.equal(review.revision,1);assert.deepEqual(expected,{project:'project',budgetRevision:3});
  return {source_request_id:'original',confirmation_id:review.operation_id,project_id:'project',binding_id:'executor',budget_revision:3,proposal_id:'command-budget',state:approved?'completed':'awaiting_approval',...(approved?{outcome:{request_id:'runtime-command',state:'completed',result:{content:'Finished private report'}}}:{})};
 }});
 await f.queue().enqueueVoiceReceipt({update:2,message:3,sender:42,request:'local'});await f.queue().drain();
 const confirm=f.sent[0].match(/\/voice_execute 2 1 [a-f0-9]{64}/)![0].replace('/voice_execute','/voice_confirm');
 await f.queue().enqueue({...message,update:3,text:confirm});await f.queue().drain();assert.match(f.sent.at(-1)!,/\/voice_run 3/);assert.equal(runs,0);
 const command={...message,update:4,text:'/voice_run 3'};
 await f.queue().enqueue(command);await f.queue().drain();assert.equal(runs,1);assert.match(f.sent.at(-1)!,/Ожидает согласования бюджета/);
 await f.queue().enqueue({...message,update:5,text:'/status 4'});await f.queue().drain();assert.equal(runs,1);assert.match(f.sent.at(-1)!,/Ожидает согласования бюджета/);
 approved=true;f.elapse(15000);await f.queue().drain();assert.equal(runs,2);assert.match(f.sent.at(-1)!,/Finished private report/);
 await f.queue().enqueue(command);await f.queue().drain();assert.equal(runs,2);
 await f.queue().enqueue({...message,update:6,text:'/status 4'});await f.queue().drain();assert.equal(runs,2);assert.match(f.sent.at(-1)!,/Finished private report/);
 const state=telegramDeliveryStates(f.storage,'channel',[4])[0];assert.equal(state.execution,'completed');assert.equal(state.voice_command?.proposal_id,'command-budget');assert.equal(state.request_id,'runtime-command');assert.doesNotMatch(JSON.stringify(state),/Finished private report/);
 await f.queue().enqueue({...message,update:7,text:'/voice_run 999'});await f.queue().drain();assert.equal(runs,2);assert.equal(f.executions(),0);assert.equal(f.reads.length,0);
 compactTelegramLocalText(f.storage,31*24*60*60*1000);assert.doesNotMatch(JSON.stringify([...f.values]),/Finished private report/);
});

test('ordinary voice reply revises the proposal; one yes runs it and repeated yes only reads the result',async()=>{
 const f=fixture();let edits=0,confirms=0,runs=0;
 Object.assign(f.ports,{voice:async()=>({request:'original',project:'project',sha256:'a'.repeat(64),recognition:{state:'completed',source_request_id:'original',project_id:'project',budget_revision:3,transcript:{revision:1,text:'Friday'}}})});
 Object.assign(f.ports.client,{
  editVoice:async(_target:number,_update:number,revision:number,text:string)=>{edits++;assert.equal(revision,1);assert.equal(text,'Monday');return {revision:2,text};},
  confirmVoice:async(_target:number,update:number,revision:number,hash:string,source:string)=>{confirms++;assert.equal(revision,2);return {source_request_id:source,operation_id:'telegram-review-'+update,revision,text_sha256:hash,current:true};},
  runVoice:async()=>{runs++;return {source_request_id:'original',project_id:'project',binding_id:'agent',budget_revision:3,proposal_id:'budget',state:'completed',outcome:{request_id:'runtime',state:'completed',result:{content:'Done Monday'}}};},
 });
 await f.queue().enqueueVoiceReceipt({update:2,message:3,sender:42,request:'local'});await f.queue().drain();assert.equal(runs,0);
 await f.queue().enqueue({update:3,message:4,sender:42,text:'Monday',replyTo:1});await f.queue().drain();assert.equal(edits,1);assert.equal(runs,0);
 await f.queue().enqueue({update:4,message:5,sender:42,text:'да',replyTo:1});await f.queue().drain();assert.equal(confirms,0);assert.equal(runs,0);
 const yes={update:5,message:6,sender:42,text:'да',replyTo:2};await f.queue().enqueue(yes);await f.queue().drain();assert.equal(confirms,1);assert.equal(runs,1);assert.match(f.sent.at(-1)!,/Done Monday/);
 await f.queue().enqueue(yes);await f.queue().drain();
 await f.queue().enqueue({...yes,update:6,message:7});await f.queue().drain();assert.equal(confirms,1);assert.equal(runs,1);assert.match(f.sent.at(-1)!,/Done Monday/);assert.equal(f.executions(),0);
});
