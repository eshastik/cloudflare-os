import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled = await build({stdin:{contents:'export {MnemosAPI} from "./src/mnemos-api.ts"; export {MnemosAccountSession} from "./src/account-session.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {MnemosAPI,MnemosAccountSession} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('Telegram channel client pins consent, checks every grant coordinate and fences revoked replies', async () => {
 let live = true, alter = x => x, after = () => {};
 const sent = [];
 const input = {request_id:'request',binding_id:'agent',bot_id:'123',sender_id:42,credential_sha256:'1'.repeat(64),confirmed:true};
 const expected = {id:'request',owner_id:'owner',binding_id:'agent',bot_id:'123',sender_id:42,revision:1,enabled:true};
 const api = new MnemosAPI('https://memory.example',async () => 'fixture',async (url,init) => {
  if (url.endsWith('/whoami')) return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}});
  sent.push({url,method:init.method,body:JSON.parse(init.body)});
  const value = alter(url.endsWith('/disable') ? {disabled:true} : {...expected,secret:'must not leave client'});
  after(); return Response.json(value);
 });
 const session = new MnemosAccountSession(api,() => live);
 const selected = {...input}, pending = session.registerTelegramChannel(selected);
 selected.sender_id = 99; selected.credential_sha256 = '2'.repeat(64);
 assert.deepEqual(await pending, expected);
 assert.deepEqual(sent[0],{url:'https://memory.example/v1/telegram-channels',method:'POST',body:input});
 for (const [key,value] of [['id','other'],['owner_id','peer'],['binding_id','other'],['bot_id','456'],['sender_id',99],['revision',2],['enabled',false]]) {
  alter = result => ({...result,[key]:value});
  await assert.rejects(session.registerTelegramChannel(input),error => error.status === 502);
 }
 alter = () => null; await assert.rejects(session.registerTelegramChannel(input),error => error.status === 502);
 alter = () => ({disabled:false}); await assert.rejects(session.disableTelegramChannel('request'),error => error.status === 502);
 alter = x => x; await session.disableTelegramChannel('request');
 assert.deepEqual(sent.at(-1),{url:'https://memory.example/v1/telegram-channels/request/disable',method:'POST',body:{}});
 after = () => {live = false};
 await assert.rejects(session.registerTelegramChannel(input),error => error.status === 401);
 const count = sent.length;
 await assert.rejects(session.disableTelegramChannel('request'),error => error.status === 401);
 assert.equal(sent.length,count);
});
test('Human journal validates owner, ordered cursor and expiry while stripping extra fields',async()=>{
 let live=true,alter=x=>x,after=()=>{};
 const base={channel:{id:'channel',owner_id:'owner',binding_id:'agent',bot_id:'123',sender_id:42,enabled:false,revision:2,secret:'hidden'},items:[{kind:'task',target_update_id:null,correction_id:null,update_id:1,message_id:2,sender_id:42,message:'<script>private</script>',criteria:'criteria',request_id:'task',secret:'hidden'}],next_after:null};
 const api=new MnemosAPI('https://memory.example',async()=> 'fixture',async(url,init)=>{
  if(url.endsWith('/whoami'))return Response.json({subject:{tenant_id:'tenant',user_id:'owner'}});
  assert.equal(url,'https://memory.example/v1/telegram-channels/channel/journal');assert.deepEqual(JSON.parse(init.body),{after:-1});
  const out=alter(structuredClone(base));after();return Response.json(out);
 });
 const session=new MnemosAccountSession(api,()=>live);
 const page=await session.telegramTaskJournal('channel');assert.equal(page.items[0].message,base.items[0].message);assert(!JSON.stringify(page).includes('hidden'));
 for(const change of [p=>({...p,channel:{...p.channel,owner_id:'peer'}}),p=>({...p,items:[...p.items,...p.items]}),p=>({...p,next_after:99}),p=>({...p,items:[{...p.items[0],sender_id:99}]})]){
  alter=change;await assert.rejects(session.telegramTaskJournal('channel'),e=>e.status===502);
 }
 alter=p=>({...p,items:[{...p.items[0],kind:'correction',target_update_id:0,correction_id:'saved-correction'}]});
 const correction=await session.telegramTaskJournal('channel');assert.equal(correction.items[0].correction_id,'saved-correction');
 alter=p=>({...p,items:[{...p.items[0],kind:'correction',target_update_id:null,correction_id:'saved'}]});await assert.rejects(session.telegramTaskJournal('channel'),e=>e.status===502);
 alter=x=>x;after=()=>{live=false};await assert.rejects(session.telegramTaskJournal('channel'),e=>e.status===401);
});

test('Telegram budget selection snapshots exact money and rejects changed or revoked replies',async()=>{
 let live=true,alter=x=>x,after=()=>{};const sent=[];
 const input={project_id:'project',policy_revision:2,limit_usd_micros:'9007199254740993',voice_binding_id:'transcriber',voice_limit_usd_micros:'123456'};
 const api=new MnemosAPI('https://memory.example',async()=> 'fixture',async(url,init)=>{
  if(url.endsWith('/whoami'))return Response.json({subject:{user_id:'owner'}});
  assert.equal(url,'https://memory.example/v1/telegram-channels/channel/budget');
  const body=init.body?JSON.parse(init.body):null;sent.push(body);
  const out=alter(body?{revision:1,...input,secret:'hidden'}:{revision:0,project_id:'',policy_revision:0,limit_usd_micros:'0'});after();return Response.json(out);
 });
 const session=new MnemosAccountSession(api,()=>live);
 assert.equal((await session.readTelegramBudget('channel')).revision,0);
 const selected={...input},pending=session.setTelegramBudget('channel',0,selected,true);selected.project_id='changed';
 assert.deepEqual(await pending,{revision:1,...input});
 assert.deepEqual(sent.at(-1),{expected_revision:0,...input,confirmed:true});
 for(const [key,value] of [['project_id','foreign'],['policy_revision',3],['revision',2],['limit_usd_micros','1'],['voice_binding_id','foreign'],['voice_limit_usd_micros','1']]){
  alter=x=>({...x,[key]:value});await assert.rejects(session.setTelegramBudget('channel',0,input,true),e=>e.status===502);
 }
 const count=sent.length;await assert.rejects(session.setTelegramBudget('channel',0,input,false),e=>e.status===400);assert.equal(sent.length,count);
 alter=x=>x;after=()=>{live=false};await assert.rejects(session.setTelegramBudget('channel',0,input,true),e=>e.status===401);
});
