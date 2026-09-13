import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

const harness = `export default {async fetch(request, env) {
 const url=new URL(request.url), owner=url.searchParams.get('owner')||'alice';
 const account=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner));
 try {
  if(url.pathname==='/login'){const nonce=await account.prepareBrowserLogin();await account.startBrowserLogin(nonce,'second');await account.acceptVerifiedCredential(owner,Date.now()+900000);return new Response('ok');}
  if(url.pathname==='/expire'){await account.acceptVerifiedCredential(owner,Date.now()+1000);return new Response('ok');}
  if(url.pathname==='/revoke'){await account.revoke();return new Response('ok');}
  const ui=await account.openManagementSession();
  try {
   const body=await request.json();
   if(url.pathname==='/poll'){await env.POLLERS.get(env.POLLERS.idFromName('123')).start('123',body.epoch);return new Response('ok');}
   if(url.pathname==='/configure')return Response.json(await ui.connectTelegram(body.request,body.token,body.binding,true));
   if(url.pathname==='/voice-inbox')return Response.json(await ui.telegramVoiceInbox(body.channel));
   if(url.pathname==='/voice-import')return Response.json(await ui.importTelegramVoice(body.channel,body.update,body.project));
   if(url.pathname==='/local-inbox')return Response.json(await ui.telegramLocalInbox(body.channel,body.after));
   if(url.pathname==='/journal')return Response.json(await ui.telegramTaskJournal(body.channel,body.after));
   if(url.pathname==='/list')return Response.json(await ui.listTelegram());
   if(url.pathname==='/describe')return Response.json(await ui.describeTelegram(body.bot));
   if(url.pathname==='/confirm')return Response.json(await ui.confirmTelegram(body.bot,body.epoch,body.sender));
   if(url.pathname==='/disconnect'){await ui.disconnectTelegram(body.bot);return new Response('ok');}
  } finally {ui[Symbol.dispose]();}
 } catch (error) {return new Response(error.message,{status:403});}
 return new Response('missing',{status:404});
}}`;

test('Secondary organization Telegram DO routes tasks, voice and cleanup correctly over restart and isolates owners', async () => {
 const state = await mkdtemp(join(tmpdir(), 'mnemos-telegram-'));
 const token = '123:synthetic_test_credential_012345678901234';
 const requestId = '11111111-1111-4111-8111-111111111111';
 let webhook, calls = 0, revokedBinding = false, loseWebhookReply = true;
 const pollingUpdates=[],pollingOffsets=[];let pollingWebhookRemoved=false;
 const voiceBytes=Buffer.from('OggS fixture original'),voiceHash=createHash('sha256').update(voiceBytes).digest('hex');let voicePuts=0,voiceDownloads=0,autoVoice=false,loseVoiceImport=true;let voiceAdmission,voiceRuns=0,voiceReviews=0,voiceEdits=0,voiceCommands=0;const voiceSources=new Map();
 const auditEvents=new Map();let loseAuditReply=true;
 const grants = new Map(), cancellations = new Set(); let loseGrantReply = true, loseDisableReply = true, failBeforeRegistration = false;
 let releaseParent;const parentWait=new Promise(resolve=>{releaseParent=resolve;});const corrections=new Map();
 let releasePollingParent;const pollingParentWait=new Promise(resolve=>{releasePollingParent=resolve;});
 const tasks = new Map(), messages = []; let modelRuns = 0, credentialRevokes = 0, budgetSubmits = 0;
 const config={iamOrigin:'https://iam.example',authorizationEndpoint:'https://provider.example/auth',tokenEndpoint:'https://provider.example/token',clientId:'client',clientSecret:'secret',iamClientSecret:'s'.repeat(40),callbackUrl:'https://workshop.example/gatekeeper/mnemos/oauth'};
 const options = {resourcePersistencePath: state, workers: [
  {name: 'harness', modules: true, script: harness, compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
   durableObjects: {ACCOUNTS: {className: 'UserAccount', scriptName: 'mnemos', useSQLite: true},POLLERS:{className:'TelegramPoller',scriptName:'mnemos',useSQLite:true}}},
  {name: 'mnemos', modules: true, scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
   durableObjects: {BOTS: {className: 'TelegramBot', useSQLite: true}},
   modulesRules: [{type: 'Text', include: ['**/*.txt']}], compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
   bindings: {MNEMOS_CALENDAR_BRIDGE_TOKEN:'audit-service-credential-01234567890123456789',MNEMOS_TELEGRAM_PUBLIC_ORIGIN:'https://telegram-proxy.example',MNEMOS_STORAGE_ORIGIN:'https://wrong-objects.example',MNEMOS_API_ORIGIN: 'https://wrong-primary.example', MNEMOS_LOGIN_CONFIG: JSON.stringify(config),MNEMOS_LOGIN_PROFILES:JSON.stringify([{id:'second',name:'Second',apiOrigin:'https://memory.example',storageOrigin:'https://objects.example',config}])},
   outboundService: async request => {
    const url = new URL(request.url);
    if(url.origin==='https://iam.example'){assert.equal(url.pathname,'/v1/session/request');return Response.json({state:'state',nonce:'nonce',expires_in_ms:300000});}
    if(url.origin==='https://objects.example'){assert.equal(request.headers.get('Authorization'),null);assert.deepEqual(Buffer.from(await request.arrayBuffer()),voiceBytes);voicePuts++;return new Response('ok');}
    if (url.origin === 'https://api.telegram.org') {
     if(url.pathname.includes('/file/bot')){voiceDownloads++;return new Response(voiceBytes);}
     if(url.pathname.endsWith('/getFile'))return Response.json({ok:true,result:{file_unique_id:'unique_voice',file_path:'voice/original.oga',file_size:voiceBytes.length}});
     calls++;
     const method = url.pathname.split('/').at(-1);
     if (method === 'getMe') return Response.json({ok: true, result: {id: 123, is_bot: true, username: 'test_bot'}});
     if(method==='deleteWebhook'){assert.deepEqual(await request.json(),{drop_pending_updates:false});pollingWebhookRemoved=true;return Response.json({ok:true,result:true});}
     if(method==='getUpdates'){const body=await request.json();assert.equal(body.limit,1);assert.equal(body.timeout,0);pollingOffsets.push(body.offset);return Response.json({ok:true,result:pollingUpdates.filter(x=>x.update_id>=body.offset).slice(0,1)});}
     if (method === 'getWebhookInfo') return Response.json({ok: true, result: {url: webhook?.url ?? ''}});
     if (method === 'sendMessage') {const body=await request.json();assert.equal(body.chat_id,42);messages.push(body.text);return Response.json({ok:true,result:{message_id:messages.length,chat:{id:42,type:'private'}}});}
     if (method === 'setWebhook') {
      const next = await request.json();
      if (webhook && loseWebhookReply) assert.equal(next.secret_token, webhook.secret_token);
      webhook = next;
      if (loseWebhookReply) {loseWebhookReply = false; return new Response('lost reply', {status:503});}
      return Response.json({ok: true, result: true});
     }
     assert.fail('Unexpected Telegram operation');
    }
    assert.equal(url.origin, 'https://memory.example');
    if(['/v1/internal/connection-audit/telegram','/v1/internal/connection-audit/local-operation'].includes(url.pathname)){
     assert.equal(request.headers.get('Authorization'),'Bearer audit-service-credential-01234567890123456789');
     const event=await request.json();
     const fields=['account_id','event_id','observed_at','owner_id','phase','protocol','tenant_id'];
     if(event.protocol==='local-operation'){
      fields.push('operation_kind','resource_sha256','before_sha256','after_sha256');
      for(const key of ['resource_sha256','before_sha256','after_sha256'])assert.match(event[key],/^[a-f0-9]{64}$/);
      assert.notEqual(event.before_sha256,event.after_sha256);
     }
     assert.deepEqual(Object.keys(event).sort(),fields.sort());assert.equal(event.owner_id,'alice');
     const prior=auditEvents.get(event.event_id);if(prior)assert.deepEqual(event,prior);auditEvents.set(event.event_id,event);
     if(loseAuditReply){loseAuditReply=false;return new Response('lost audit receipt',{status:503});}
     return Response.json({event_id:event.event_id});
    }

    if (url.pathname.startsWith('/v1/telegram-channel-access/')) {
     const parts=url.pathname.split('/'),channel=parts[4],grant=grants.get(channel);
     const secret=request.headers.get('Authorization')?.slice(7)??'';
     assert.equal(parts[3],'tenant');assert.equal(secret.length,43);
     if(!grant||createHash('sha256').update(secret).digest('hex')!==grant.input.credential_sha256)return new Response('revoked',{status:403});
     if(parts[5]==='revoke'){
      assert.equal(request.method,'POST');assert.deepEqual(await request.json(),{});
      grant.info.enabled=false;grant.info.revision=2;credentialRevokes++;
      if(credentialRevokes===1)return new Response('lost cleanup reply',{status:503});
      return Response.json({disabled:true});
     }
     if(!grant.info.enabled||revokedBinding)return new Response('revoked',{status:403});
     if(parts.length===5)return Response.json(grant.info);
     if(parts[5]==='voices'){
      const budget={revision:3,project_id:'voice-project',policy_revision:1,limit_usd_micros:'500000',...(autoVoice?{voice_binding_id:'voice-agent',voice_limit_usd_micros:'100000'}:{})};
      if(parts[6]==='settings')return Response.json(budget);
      if(parts.length===6){const body=await request.json();assert.equal(body.expected_budget_revision,3);assert.equal(body.sha256,voiceHash);assert.equal(body.update_id,40);if(voiceAdmission)assert.deepEqual(body,Object.fromEntries(Object.entries(voiceAdmission).filter(([k])=>!['request_id','budget'].includes(k))));else voiceAdmission={...body,request_id:'tgv-'+'d'.repeat(64),budget};return Response.json(voiceAdmission);}
      assert.equal(parts[6],'40');
      if(parts[7]==='edit'){voiceEdits++;const body=await request.json();assert.deepEqual(body,{update_id:43,sender_id:42,expected_revision:1,text:'Prepare the report on Monday.'});return Response.json({source_request_id:voiceAdmission.request_id,operation_id:'telegram-edit-43',revision:2,kind:'human',text:body.text,provider:'',model_id:'',provider_request_id:'',uncertain:true});}
      if(parts[7]==='run'){voiceCommands++;const body=await request.json();assert.deepEqual(body,{sender_id:42,confirmation_update_id:44,revision:2,text_sha256:createHash('sha256').update('Prepare the report on Monday.').digest('hex'),confirmed:true});return Response.json({source_request_id:voiceAdmission.request_id,confirmation_id:'telegram-review-44',project_id:'voice-project',binding_id:grant.info.binding_id,budget_revision:3,proposal_id:'command-budget',state:'completed',outcome:{request_id:'voice-command-runtime',state:'completed',result:{content:'Report scheduled for Monday.'}}});}
      if(parts[7]==='confirm'){voiceReviews++;const body=await request.json();const revision=body.update_id===42?1:2;assert.deepEqual(body,{update_id:revision===1?42:44,sender_id:42,revision,text_sha256:createHash('sha256').update(revision===1?'Please prepare the quarterly report.':'Prepare the report on Monday.').digest('hex'),confirmed:true});return Response.json({source_request_id:voiceAdmission.request_id,operation_id:'telegram-review-'+body.update_id,revision,text_sha256:body.text_sha256,current:true});}
      if(parts[7]==='transcribe'){voiceRuns++;return Response.json({update_id:40,source_request_id:voiceAdmission.request_id,project_id:'voice-project',proposal_id:'voice-budget',binding_id:'voice-agent',budget_revision:3,state:'completed',transcript:{source_request_id:voiceAdmission.request_id,revision:1,operation_id:'voice-runtime',kind:'provider',text:'Please prepare the quarterly report.',provider:'fixture',model_id:'fixture',provider_request_id:'fixture-request',uncertain:true}});}
      if(parts[7]==='upload')return Response.json({upload_id:'scoped-voice-upload',url:'https://objects.example/automatic',method:'PUT',content_length:voiceBytes.length,checksum_header:'x-amz-checksum-sha256',checksum_value:Buffer.from(voiceHash,'hex').toString('base64')});
      assert.equal(parts[7],'import');assert.deepEqual(await request.json(),{upload_id:'scoped-voice-upload'});
      const original={request_id:voiceAdmission.request_id,project_id:'voice-project',media_type:'audio/ogg',size_bytes:voiceBytes.length,sha256:voiceHash};voiceSources.set(original.request_id,original);
      if(loseVoiceImport){loseVoiceImport=false;return new Response('lost reply',{status:503})}return Response.json(original);
     }
     if(parts[5]==='corrections'){
      const body=await request.json();assert.ok([10,1030].includes(body.target_update_id));assert.equal(body.sender_id,42);assert.equal(body.message,body.target_update_id===10?'Уточни срок':'/correct 1030 Уточни срок');
      assert.equal(body.request_id,undefined);assert.ok(tasks.has(body.target_update_id),'parent must be admitted before correction');
      const existing=corrections.get(body.update_id);if(existing)assert.deepEqual(existing,body);else corrections.set(body.update_id,body);
      if(body.target_update_id===10)releaseParent();else releasePollingParent();
      return Response.json({update_id:body.update_id,target_update_id:body.target_update_id,outcome:{request_id:'task-'+body.target_update_id,correction_id:'correction-'+body.update_id,sequence:1,journalled:false}});
     }
     assert.equal(parts[5],'tasks');let update;
     if(request.method==='POST'){
      const body=await request.json();update=body.update_id;
      assert.equal(body.sender_id,42);assert.ok(body.criteria);assert.equal(body.request_id,undefined);
      const previous=tasks.get(update);
      if(previous)assert.deepEqual(previous.body,body);else{
       if(update===20)budgetSubmits++;else modelRuns++;
       tasks.set(update,{body,out:{update_id:update,request_id:'task-'+update,
        budget:{update_id:update,request_id:'task-'+update,budget_revision:2,project_id:'budget-project',proposal_id:'proposal-'+update,state:update===20?'awaiting_approval':'approved'},
        outcome:update===20?{request_id:'task-'+update,state:'unconfirmed'}:{request_id:'task-'+update,state:'completed',result:{content:'Worker task answer'}}}});
      }
     }else{assert.equal(request.method,'GET');update=Number(parts[6]);}
     if(request.method==='POST'&&update===10)await parentWait;
     if(request.method==='POST'&&update===1030)await pollingParentWait;
     return tasks.has(update)?Response.json(tasks.get(update).out):new Response('missing',{status:409});
    }
    const owner = request.headers.get('Authorization')?.slice(7);
    assert.ok(['alice', 'bob'].includes(owner));
    if(url.pathname.endsWith('/journal')){
     const channel=url.pathname.split('/')[3],grant=grants.get(channel);
     if(!grant||grant.info.owner_id!==owner)return new Response('denied',{status:403});
     const {after}=await request.json();
     return Response.json({channel:grant.info,items:[...[...tasks.values()].map(task=>({...task.body,request_id:task.out.request_id,kind:'task',target_update_id:null,correction_id:null})),...[...corrections.values()].map(source=>({...source,criteria:'',kind:'correction',request_id:tasks.get(source.target_update_id).out.request_id,correction_id:'correction-12'}))].filter(source=>source.update_id>after).sort((a,b)=>a.update_id-b.update_id),next_after:null});
    }
    if (url.pathname === '/v1/telegram-channels') {
     const input = await request.json();
     if (failBeforeRegistration) return new Response('request did not reach registry', {status:503});
     if (cancellations.has(owner+':'+input.request_id)) return new Response('cancelled', {status:409});
     assert.equal(input.binding_id, 'agent-'+owner); assert.equal(input.bot_id, '123'); assert.equal(input.sender_id, 42);
     assert.equal(input.confirmed, true); assert.match(input.credential_sha256, /^[a-f0-9]{64}$/);
     assert.deepEqual(Object.keys(input).sort(), ['binding_id','bot_id','confirmed','credential_sha256','request_id','sender_id']);
     const previous = grants.get(input.request_id);
     if (previous) {assert.deepEqual(previous.input, input); if (!previous.info.enabled) return new Response('disabled',{status:409});}
     const info = previous?.info ?? {id: input.request_id, owner_id: owner, binding_id: input.binding_id, bot_id: input.bot_id, sender_id: input.sender_id, revision:1, enabled:true};
     grants.set(input.request_id, {input, info});
     if (loseGrantReply) {loseGrantReply = false; return new Response('lost grant reply',{status:503});}
     return Response.json(info);
    }
    if (url.pathname.startsWith('/v1/telegram-channels/') && url.pathname.endsWith('/disable')) {
     const id = url.pathname.split('/')[3], grant = grants.get(id);
     if (!grant) {cancellations.add(owner+':'+id); return Response.json({disabled:true});}
     assert.equal(grant.info.owner_id, owner);
     grant.info.enabled = false; grant.info.revision = 2;
     if (loseDisableReply) {loseDisableReply = false; return new Response('lost disable reply',{status:503});}
     return Response.json({disabled:true});
    }
    if(url.pathname==='/v1/uploads'){const body=await request.json();assert.equal(body.project_id,'voice-project');assert.equal(body.size_bytes,voiceBytes.length);return Response.json({upload_id:'voice-upload',url:'https://objects.example/original',method:'PUT',content_length:voiceBytes.length,checksum_header:'x-amz-checksum-sha256',checksum_value:body.checksum_sha256});}
    if(url.pathname==='/v1/voice-sources'){const body=await request.json();assert.equal(body.upload_id,'voice-upload');const source={request_id:body.request_id,project_id:body.project_id,media_type:body.media_type,size_bytes:voiceBytes.length,sha256:voiceHash};voiceSources.set(body.request_id,source);return Response.json(source);}
    if(url.pathname.startsWith('/v1/voice-sources/')){assert.equal(owner,'alice');const source=voiceSources.get(url.pathname.split('/').at(-1));assert.ok(source);return Response.json(source);}
    if (url.pathname === '/v1/whoami') return Response.json({subject: {tenant_id: 'tenant', user_id: owner}});
    if (url.pathname === '/v1/agent-connections') return Response.json({connections: [{binding_id: 'agent-'+owner, agent_principal_id: owner+'-principal', revoked: revokedBinding, managed_runtime: true}]});
    assert.fail('Unexpected Mnemos route: '+url.pathname);
   }},
 ]};
 let mf = new Miniflare(options);
 const call = (path, body = {}, owner = 'alice') => mf.dispatchFetch('https://fixture'+path+'?owner='+owner,
   {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)});
 const internalWebhook=()=>new URL(config.callbackUrl).origin+new URL(webhook.url).pathname;
 const deliver = async (text, sender = 42, secret = webhook.secret_token, update = 1, replyTo) => {
  const worker = await mf.getWorker('mnemos');
  return worker.fetch(internalWebhook(), {method: 'POST', headers: {'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token': secret},
   body: JSON.stringify({update_id: update, message: {message_id: update+1, from: {id: sender, is_bot: false}, chat: {id: sender, type: 'private'}, text,...(replyTo?{reply_to_message:{message_id:replyTo,chat:{id:sender,type:'private'}}}:{})}})});
 };
 const waitMessages=async count=>{const until=Date.now()+3000;while(messages.length<count&&Date.now()<until)await pause(10);assert.equal(messages.length,count);};
 try {
  const routeWorker=await mf.getWorker('mnemos');
  assert.equal((await routeWorker.fetch(config.callbackUrl+'/telegram/'+'a'.repeat(64),{method:'POST',body:'{}'})).status,404);
  await call('/login'); await call('/login', {}, 'bob');
  const setup = {request: requestId, token, binding: 'agent-alice'};
  assert.equal((await call('/configure', setup)).status, 403, 'lost provider reply remains unconfirmed');
  assert.equal(new URL(webhook.url).origin,'https://telegram-proxy.example');
  const pendingSecret = webhook.secret_token;
  const configured = await call('/configure', setup);
  assert.equal(configured.status, 200, await configured.clone().text());
  const first = await configured.json();
  assert.equal(first.ready, true); assert.equal(first.sender, null); assert.equal(first.token, undefined); assert.equal(first.secret, undefined);
  assert.equal(webhook.secret_token, pendingSecret, 'retry resumes the same delivery configuration');
  assert.equal(webhook.drop_pending_updates, false);
  assert.equal((await deliver('/start '+first.code, 42, 'wrong')).status, 403);
  assert.equal((await deliver('/start '+first.code)).status, 200);
  assert.equal((await (await call('/describe', {bot:'123'})).json()).candidate, 42);
  assert.equal((await deliver('/start '+first.code)).status,200);
  assert.equal((await deliver('Do not run before confirmation')).status,200);
  assert.equal(modelRuns,0);assert.equal(grants.size,0);
  assert.equal((await call('/confirm', {bot:'123', epoch:first.epoch, sender:99})).status, 403);
  assert.equal((await call('/confirm', {bot:'123', epoch:first.epoch, sender:42})).status, 403, 'lost grant reply remains unconfirmed');
  assert.equal(grants.size, 1);
  const confirmed = await call('/confirm', {bot:'123', epoch:first.epoch, sender:42});
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  const confirmation = await confirmed.json();
  assert.equal(confirmation.channel_registered, true); assert.equal(grants.size, 1);
  assert.equal(confirmation.channel_id, [...grants.keys()][0]);
  assert.equal(confirmation.credential_sha256, undefined); assert.equal(confirmation.secret, undefined);
  const before = calls;
  assert.equal((await call('/configure', {...setup,binding:'agent-bob'}, 'bob')).status, 403);
  assert.equal((await call('/describe', {bot:'123'}, 'bob')).status, 403);
  assert.equal(calls, before, 'foreign account must not touch Telegram delivery');
  await mf.dispose(); mf = new Miniflare(options);
  const restored = await (await call('/describe', {bot:'123'})).json();
  assert.equal(restored.sender, 42); assert.equal(restored.epoch, first.epoch); assert.equal(restored.code, null);
  const catalogue=await (await call('/list')).json();
  assert.equal(catalogue.connections.length,1);assert.equal(catalogue.connections[0].bot,'123');assert.equal(catalogue.unavailable,0);
  assert.deepEqual(Object.keys(catalogue.connections[0]).sort(),['binding','bot','channel_registered','cleanup_pending','disconnected','ready','username']);
  const foreignCatalogue=await (await call('/list',{},'bob')).json();
  assert.deepEqual(foreignCatalogue.connections,[]);assert.equal(foreignCatalogue.unavailable,1,'failed takeover attempt is not an owned bot');
  assert.equal(restored.channel_id, confirmation.channel_id);
  assert.equal((await call('/confirm', {bot:'123', epoch:first.epoch, sender:42})).status, 200);
  assert.equal(grants.size, 1, 'Worker restart must not create another channel');
  const replay = await (await call('/configure', setup)).json();
  assert.equal(replay.epoch, first.epoch); assert.equal(replay.sender, 42);
  assert.equal((await deliver('Task command',42,webhook.secret_token,10)).status,200);
  for(let i=0;i<100&&!tasks.has(10);i++)await pause(10);
  assert.ok(tasks.has(10));assert.equal(messages.length,0,'task response is still in flight');
  const local=await (await call('/local-inbox',{channel:confirmation.channel_id,after:-1})).json();assert.equal(local.items[0].message,'Task command');assert.equal(local.items[0].state.queue,'pending');assert.equal(local.items[0].state.request_id,null);
  assert.equal((await call('/local-inbox',{channel:confirmation.channel_id,after:-1},'bob')).status,403);
  assert.equal((await deliver('Уточни срок',42,webhook.secret_token,12,11)).status,200);
  await waitMessages(2);assert.equal(modelRuns,1);assert.equal(corrections.size,1);
  assert.ok(messages.some(text=>text.includes('Worker task answer')));assert.ok(messages.some(text=>text.includes('Корректировка')));
  assert.equal((await deliver('Task command',42,webhook.secret_token,10)).status,200);
  await pause(20);assert.equal(messages.length,2);assert.equal(modelRuns,1);
  assert.equal((await call('/expire')).status,200);await pause(1100);
  await mf.dispose();mf=new Miniflare(options);
  assert.equal((await call('/describe',{bot:'123'})).status,403,'browser credential really expired');
  assert.equal((await deliver('/status',42,webhook.secret_token,11)).status,200);
  await waitMessages(3);assert.equal(modelRuns,1,'status after restart/expiry must not run another task');
  assert.match(messages[2],/Worker task answer/);
  assert.equal((await deliver('Уточни срок',42,webhook.secret_token,12,11)).status,200);
  await pause(20);assert.equal(messages.length,3);assert.equal(corrections.size,1);
  await call('/login');
  assert.equal((await deliver('Budget approval task',42,webhook.secret_token,20)).status,200);
  await waitMessages(4);assert.match(messages[3],/ожидает согласования бюджета/);
  assert.equal(budgetSubmits,1);assert.equal(modelRuns,1,'waiting budget must not execute');
  const waiting=await (await call('/local-inbox',{channel:confirmation.channel_id,after:19})).json();
  assert.equal(waiting.items[0].state.budget.state,'awaiting_approval');
  assert.equal(waiting.items[0].state.budget.proposal_id,'proposal-20');
  await mf.dispose();mf=new Miniflare(options);
  assert.equal((await deliver('/status 20',42,webhook.secret_token,21)).status,200);
  await waitMessages(5);assert.match(messages[4],/ожидает согласования бюджета/);
  assert.equal(budgetSubmits,1,'status after restart cannot submit another proposal');assert.equal(modelRuns,1);
  const restoredBudget=await (await call('/local-inbox',{channel:confirmation.channel_id,after:19})).json();
  assert.equal(restoredBudget.items[0].state.budget.budget_revision,2);
  const voiceWorker=await mf.getWorker('mnemos');
  const voiceResponse=await voiceWorker.fetch(internalWebhook(),{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':webhook.secret_token},body:JSON.stringify({update_id:30,message:{message_id:31,from:{id:42,is_bot:false},chat:{id:42,type:'private'},voice:{file_id:'voice_id',file_unique_id:'unique_voice',duration:4,mime_type:'audio/ogg',file_size:voiceBytes.length}}})});
  assert.equal(voiceResponse.status,200);
  await waitMessages(6);assert.match(messages[5],/Голосовое сообщение получено/);assert.match(messages[5],/Автоматическое распознавание пока не включено/);assert.equal(modelRuns,1);
  const voiceReceipt=await (await call('/local-inbox',{channel:confirmation.channel_id,after:29})).json();assert.equal(voiceReceipt.items[0].kind,'voice');assert.equal(voiceReceipt.items[0].state.execution,null);assert.deepEqual(voiceReceipt.items[0].state.delivery,[{phase:'voice',state:'delivered'}]);
  const voices=await (await call('/voice-inbox',{channel:confirmation.channel_id})).json();assert.equal(voices.length,1);assert.equal(voices[0].update,30);assert.equal(voices[0].file_id,undefined);
  assert.equal((await call('/voice-import',{channel:confirmation.channel_id,update:30,project:'voice-project'},'bob')).status,403);
  const imported=await call('/voice-import',{channel:confirmation.channel_id,update:30,project:'voice-project'});assert.equal(imported.status,200,await imported.clone().text());const original=await imported.json();assert.equal(original.sha256,voiceHash);assert.equal(original.request_id,voices[0].request);
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await (await call('/voice-inbox',{channel:confirmation.channel_id})).json(),[]);
  assert.deepEqual(await (await call('/voice-import',{channel:confirmation.channel_id,update:30,project:'voice-project'})).json(),original);assert.equal(voicePuts,1);assert.equal(voiceDownloads,1,'saved original must not be downloaded from Telegram again');
  assert.equal((await call('/voice-import',{channel:confirmation.channel_id,update:30,project:'other-project'})).status,403);
  autoVoice=true;await call('/expire');await pause(1100);
  const automaticPayload={update_id:40,message:{message_id:41,forward_origin:{type:'user',sender_user:{id:99,is_bot:true}},from:{id:42,is_bot:false},chat:{id:42,type:'private'},voice:{file_id:'voice_id',file_unique_id:'unique_voice',duration:4,mime_type:'audio/ogg',file_size:voiceBytes.length}}};
  const deliverAutomatic=async()=>{const worker=await mf.getWorker('mnemos');return worker.fetch(internalWebhook(),{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':webhook.secret_token},body:JSON.stringify(automaticPayload)});};
  assert.equal((await deliverAutomatic()).status,200);
  for(let i=0;i<100&&loseVoiceImport;i++)await pause(10);assert.equal(loseVoiceImport,false);assert.equal(voicePuts,2);assert.equal(voiceDownloads,2);
  await mf.dispose();mf=new Miniflare(options);await waitMessages(7);
  assert.match(messages[6],/Из голосового сообщения я понял/);assert.match(messages[6],/Please prepare the quarterly report/);assert.match(messages[6],/Выполнить это поручение/);assert.equal(voiceRuns,1);assert.match(messages[6],/tgv-ddd/);assert.equal(modelRuns,1);
  assert.equal((await deliverAutomatic()).status,200);await pause(20);assert.equal(messages.length,7);assert.equal(voiceRuns,1);assert.equal(voicePuts,2);assert.equal(voiceDownloads,2);
  const reviewCommand=messages[6].match(/\/voice_execute 40 1 [a-f0-9]{64}/)?.[0]?.replace('/voice_execute','/voice_confirm');assert.ok(reviewCommand);
  const reviewPayload={update_id:42,message:{message_id:43,from:{id:42,is_bot:false},chat:{id:42,type:'private'},text:reviewCommand}};
  const deliverReview=async()=>{const worker=await mf.getWorker('mnemos');return worker.fetch(internalWebhook(),{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':webhook.secret_token},body:JSON.stringify(reviewPayload)});};
  assert.equal((await deliverReview()).status,200);await waitMessages(8);assert.match(messages[7],/Текст версии 1 подтверждён/);assert.equal(voiceReviews,1);assert.equal(modelRuns,1);
  await mf.dispose();mf=new Miniflare(options);assert.equal((await deliverReview()).status,200);await pause(20);assert.equal(messages.length,8);assert.equal(voiceReviews,1);assert.equal(voiceRuns,1);
  const editPayload={update_id:43,message:{message_id:44,from:{id:42,is_bot:false},chat:{id:42,type:'private'},text:'Prepare the report on Monday.',reply_to_message:{message_id:7,chat:{id:42,type:'private'}}}};
  const deliverEdit=async()=>{const worker=await mf.getWorker('mnemos');return worker.fetch(internalWebhook(),{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':webhook.secret_token},body:JSON.stringify(editPayload)});};
  assert.equal((await deliverEdit()).status,200);await waitMessages(9);assert.match(messages[8],/Поручение уточнено/);assert.match(messages[8],/Prepare the report on Monday/);assert.match(messages[8],/\/voice_execute 40 2 /);assert.equal(voiceEdits,1);
  await mf.dispose();mf=new Miniflare(options);assert.equal((await deliverEdit()).status,200);await pause(20);assert.equal(messages.length,9);assert.equal(voiceEdits,1);assert.equal(modelRuns,1);assert.equal(voiceRuns,1);
  const correctedReview=messages[8].match(/\/voice_execute 40 2 [a-f0-9]{64}/)?.[0];assert.ok(correctedReview);
  const deliverVoiceText=async(update,text,replyTo)=>{const worker=await mf.getWorker('mnemos');return worker.fetch(internalWebhook(),{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':webhook.secret_token},body:JSON.stringify({update_id:update,message:{message_id:update+1,from:{id:42,is_bot:false},chat:{id:42,type:'private'},text,...(replyTo?{reply_to_message:{message_id:replyTo,chat:{id:42,type:'private'}}}:{})}})});};
  assert.equal((await deliverVoiceText(44,'да',9)).status,200);await waitMessages(10);assert.match(messages[9],/Report scheduled for Monday/);assert.equal(voiceCommands,1);
  assert.equal((await deliverVoiceText(45,'/status 44')).status,200);await waitMessages(11);assert.match(messages[10],/Report scheduled for Monday/);assert.equal(voiceCommands,1);
  await mf.dispose();mf=new Miniflare(options);assert.equal((await deliverVoiceText(45,'/status 44')).status,200);await pause(20);assert.equal(messages.length,11);assert.equal(voiceCommands,1);
  assert.equal((await deliverVoiceText(46,'/status 45')).status,200);await waitMessages(12);assert.match(messages[11],/Report scheduled for Monday/);assert.equal(voiceCommands,1);assert.equal(modelRuns,1);assert.equal(voiceRuns,1);
  await call('/login');assert.deepEqual(await (await call('/voice-inbox',{channel:confirmation.channel_id})).json(),[]);
  const automaticOriginal=await (await call('/voice-import',{channel:confirmation.channel_id,update:40,project:'voice-project'})).json();assert.equal(automaticOriginal.request_id,voiceAdmission.request_id);assert.equal(voicePuts,2);assert.equal(voiceDownloads,2);
  revokedBinding = true;
  assert.equal((await call('/voice-inbox',{channel:confirmation.channel_id})).status,403);
  assert.equal((await call('/voice-import',{channel:confirmation.channel_id,update:30,project:'voice-project'})).status,403);
  assert.equal((await call('/describe', {bot:'123'})).status, 200, 'owner can inspect configuration after agent revocation');
  assert.equal((await call('/confirm', {bot:'123', epoch:first.epoch, sender:42})).status, 403);
  assert.equal((await call('/disconnect', {bot:'123'})).status, 403, 'lost revoke reply stays pending');
  assert.equal((await deliver('/start '+first.code)).status, 404);
  assert.equal((await (await call('/describe', {bot:'123'})).json()).cleanup_pending, true);
  await mf.dispose(); mf = new Miniflare(options);
  assert.equal((await call('/disconnect', {bot:'123'})).status, 200, 'owner can retry cleanup after restart and agent revocation');
  const disabled = await (await call('/describe', {bot:'123'})).json();
  assert.equal(disabled.disconnected, true); assert.equal(disabled.cleanup_pending, false); assert.equal(disabled.channel_registered, false);
  const history=await call('/journal',{channel:confirmation.channel_id,after:-1});
  assert.equal(history.status,200);
  const sourceJournal=await history.json();assert.equal(sourceJournal.channel.enabled,false);
  assert.equal(sourceJournal.items.length,3);assert.equal(sourceJournal.delivery.find(item=>item.update_id===10).budget.state,'approved');assert.equal(sourceJournal.delivery.find(item=>item.update_id===20).budget.state,'awaiting_approval');assert.equal(sourceJournal.items[1].kind,'correction');assert.equal(sourceJournal.items[1].target_update_id,10);assert.equal(sourceJournal.delivery.find(item=>item.update_id===10).execution,'completed');assert.equal(sourceJournal.delivery.find(item=>item.update_id===12).correction,'queued');assert.equal(sourceJournal.items[0].message,'Task command');
  assert.equal(modelRuns,1,'human source journal must not execute tasks');
  assert.equal((await call('/journal',{channel:confirmation.channel_id,after:-1},'bob')).status,403);
  revokedBinding = false;
  const newSetup = await call('/configure', {...setup,request:'22222222-2222-4222-8222-222222222222'});
  assert.equal(newSetup.status, 200);
  assert.equal((await call('/configure', setup)).status, 403, 'late retry cannot replace newer setup');
  const newInfo = await newSetup.json();
  assert.equal((await deliver('/start '+newInfo.code)).status, 200);
  failBeforeRegistration = true;
  assert.equal((await call('/confirm', {bot:'123',epoch:newInfo.epoch,sender:42})).status, 403);
  const pendingChannel = await (await call('/describe', {bot:'123'})).json();
  assert.equal(pendingChannel.channel_registered, false);
  assert.equal((await call('/disconnect', {bot:'123'})).status, 200, 'cancel even when registration never arrived');
  assert.ok(cancellations.has('alice:'+pendingChannel.channel_id));
  failBeforeRegistration = false;
  const thirdSetup = await call('/configure', {...setup,request:'33333333-3333-4333-8333-333333333333'});
  assert.equal(thirdSetup.status, 200);
  const thirdInfo=await thirdSetup.json();
  assert.equal((await deliver('/start '+thirdInfo.code)).status,200);
  const thirdGrant=await (await call('/confirm',{bot:'123',epoch:thirdInfo.epoch,sender:42})).json();
  assert.equal(thirdGrant.channel_registered,true);
  await call('/expire');await pause(1100);
  assert.equal((await call('/describe',{bot:'123'})).status,403);
  assert.equal((await call('/revoke')).status,200);
  assert.equal((await deliver('must not run',42,webhook.secret_token,99)).status,404);
  for(let i=0;i<100&&grants.get(thirdGrant.channel_id).info.enabled;i++)await pause(10);
  assert.equal(grants.get(thirdGrant.channel_id).info.enabled,false);
  assert.equal(modelRuns,1);
  await mf.dispose();mf=new Miniflare(options);
  assert.equal((await call('/revoke')).status,200,'repeat after restart needs no human credential');
  for(let i=0;i<100&&credentialRevokes<2;i++)await pause(10);
  assert.equal(credentialRevokes,2);
  await call('/login');
  const cleaned=await (await call('/describe',{bot:'123'})).json();
  assert.equal(cleaned.cleanup_pending,false);

  // A fresh connection can pair through native polling without a public route
  // or an external per-bot process. Exercise actual Worker/SQLite alarms.
  options.workers[1].bindings.MNEMOS_TELEGRAM_DELIVERY_MODE='polling';
  await mf.dispose();mf=new Miniflare(options);
  const pollingSetup=await call('/configure',{...setup,request:'44444444-4444-4444-8444-444444444444'});
  assert.equal(pollingSetup.status,200,await pollingSetup.clone().text());
  assert.equal(pollingWebhookRemoved,true);
  const pollingInfo=await pollingSetup.json();
  const incoming=(id,text,sender=42)=>({update_id:id,message:{message_id:id+1,from:{id:sender,is_bot:false},chat:{id:sender,type:'private'},text}});
  pollingUpdates.push(incoming(999,'command sent before pairing'),incoming(1000,'/start '+pollingInfo.code));
  const poke=()=>call('/poll',{epoch:pollingInfo.epoch});
  const until=async check=>{const end=Date.now()+3000;while(!await check()&&Date.now()<end)await pause(10);assert.equal(await check(),true,JSON.stringify({lastPollingOffsets:pollingOffsets.slice(-8),modelRuns,corrections:[...corrections.keys()]}));};
  await poke();
  await until(async()=>(await(await call('/describe',{bot:'123'})).json()).candidate===42);
  const pollingGrant=await(await call('/confirm',{bot:'123',epoch:pollingInfo.epoch,sender:42})).json();
  assert.equal(pollingGrant.channel_registered,true);
  pollingUpdates.push(incoming(1001,'must not execute',99));
  await poke();await until(()=>pollingOffsets.includes(1002));
  assert.equal(modelRuns,1,'another sender must not dispatch work');
  revokedBinding=true;pollingUpdates.push(incoming(1002,'/status'));
  const beforePolls=pollingOffsets.length,beforeMessages=messages.length;
  await poke();await until(()=>pollingOffsets.length>beforePolls);
  await poke();await until(()=>pollingOffsets.length>beforePolls+1);
  assert.equal(pollingOffsets.at(-1),1002,'failed Worker admission must not acknowledge the update');
  assert.equal(messages.length,beforeMessages);
  revokedBinding=false;await poke();await waitMessages(beforeMessages+1);
  await mf.dispose();mf=new Miniflare(options);await poke();
  await until(()=>pollingOffsets.at(-1)===1003);
  assert.equal(messages.length,beforeMessages+1,'restart must not resend an accepted update');
  assert.equal(modelRuns,1,'polling status and replay must not launch models');
  pollingUpdates.push(incoming(1030,'Task awaiting a correction'));
  await poke();await until(()=>tasks.has(1030));
  const pendingMessages=messages.length;
  pollingUpdates.push(incoming(1031,'/correct 1030 Уточни срок'));
  await poke();await until(()=>corrections.has(1031));
  await waitMessages(pendingMessages+2);
  assert.equal(modelRuns,2,'correction must reach the running task without creating another task');
  assert.equal((await call('/disconnect',{bot:'123'})).status,200);
  await until(()=>[...auditEvents.values()].some(e=>e.phase==='removed'));
  await until(()=>['telegramDeliveryJob','telegramVoice','telegramVoiceTransfer','telegramVoiceSettings'].every(kind=>[...auditEvents.values()].some(e=>e.operation_kind===kind)));
  for(const phase of ['connecting','ready','pairing-candidate','channel-pending','enabled','removed'])assert.ok([...auditEvents.values()].some(e=>e.phase===phase),'delivered phase '+phase);

 } finally {await mf.dispose(); await rm(state, {recursive:true,force:true});}
});
