import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramAPI} from './telegram-api.ts';

const token = '123:synthetic_test_credential_012345678901234';
const endpoint = 'https://example.test/telegram/connection';
const secret = 'synthetic_secret_01234567890123456789';
test('Polling setup preserves pending input and cannot displace another connection',async()=>{
  let webhook=endpoint;
  const calls:{method:string;body:Record<string,unknown>}[]=[];
  const api=new TelegramAPI(token,async(input,init)=>{
    const method=new URL(String(input)).pathname.split('/').at(-1)!;
    calls.push({method,body:JSON.parse(String(init?.body))});
    return Response.json({ok:true,result:method==='getMe'?{id:123,is_bot:true,username:'test_bot'}:method==='getWebhookInfo'?{url:webhook}:true});
  });
  await api.connectPolling(endpoint);
  assert.deepEqual(calls.map(x=>x.method),['getMe','getWebhookInfo','deleteWebhook']);
  assert.deepEqual(calls[2].body,{drop_pending_updates:false});
  calls.length=0;webhook='https://other.test/bot';
  await assert.rejects(api.connectPolling(endpoint),/another webhook/);
  assert.deepEqual(calls.map(x=>x.method),['getMe','getWebhookInfo']);
  calls.length=0;webhook='';await api.connectPolling(endpoint);
  assert.deepEqual(calls.map(x=>x.method),['getMe','getWebhookInfo']);
});
test('Polling forwards original input and refuses ambiguous acknowledgement coordinates',async()=>{
  const original={update_id:12,message:{message_id:4,voice:{file_id:'source'}}};
  let result:unknown=[original],calls=0;
  const api=new TelegramAPI(token,async(input,init)=>{
    calls++;assert.ok(String(input).endsWith('/getUpdates'));
    assert.deepEqual(JSON.parse(String(init?.body)),{offset:12,limit:1,timeout:0,allowed_updates:['message']});
    return Response.json({ok:true,result});
  });
  assert.deepEqual(await api.pollUpdate(12),original);
  result=[];assert.equal(await api.pollUpdate(12),null);
  for(const malformed of [[{update_id:11}],[{update_id:true}],[{update_id:Number.MAX_SAFE_INTEGER}],[original,original],{}]){
    result=malformed;await assert.rejects(api.pollUpdate(12),/update response/);
  }
  const before=calls;
  await assert.rejects(api.pollUpdate(-1),/offset/);
  await assert.rejects(api.pollUpdate(NaN),/offset/);
  assert.equal(calls,before);
});
test('Bot setup probes identity, preserves queued updates, and refuses another webhook', async () => {
  let webhook = '', bot = 123;
  const calls: {method: string; body: Record<string, unknown>}[] = [];
  const api = new TelegramAPI(token, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.telegram.org');
    assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    const method = url.pathname.split('/').at(-1)!;
    calls.push({method, body: JSON.parse(String(init?.body))});
    return Response.json({ok: true, result: method === 'getMe' ? {id: bot, is_bot: true, username: 'test_bot'} : method === 'getWebhookInfo' ? {url: webhook} : true});
  });
  await api.connectWebhook(endpoint, secret);
  assert.deepEqual(calls.map(x => x.method), ['getMe', 'getWebhookInfo', 'setWebhook']);
  assert.deepEqual(calls[2].body, {url: endpoint, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false});
  calls.length = 0; webhook = 'https://other.test/bot';
  await assert.rejects(api.connectWebhook(endpoint, secret), /another webhook/);
  assert.deepEqual(calls.map(x => x.method), ['getMe', 'getWebhookInfo']);
  calls.length = 0; bot = 456;
  await assert.rejects(api.connectWebhook(endpoint, secret), /identity/);
  assert.equal(calls.length, 1);
});
test('Transport sanitizes token-bearing failures, bounds replies and never retries an uncertain send', async () => {
  for (const mode of ['throw', 'redirect', 'large', 'denied', 'wrong-chat']) {
    let count = 0;
    const api = new TelegramAPI(token, async (url, init) => {
      count++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.parse_mode, undefined); assert.equal(body.chat_id, 42);
      if (mode === 'throw') throw Error('Network error: ' + String(url));
      if (mode === 'redirect') return new Response(null, {status: 302, headers: {location: 'https://other.test'}});
      if (mode === 'large') return new Response('x'.repeat(65537));
      if (mode === 'denied') return Response.json({ok: false, description: token});
      return Response.json({ok: true, result: {message_id: 1, chat: {id: 99, type: 'private'}}});
    });
    await assert.rejects(api.reply(42, '<b>plain text</b>'), (error: Error) => {
      assert.equal(error.message.includes(token), false); assert.equal(error.cause, undefined); return true;
    });
    assert.equal(count, 1);
  }
});


const voice={file_id:'voice_id',file_unique_id:'unique_voice',duration:4,mime_type:'audio/ogg',file_size:3};
test('Voice download pins source identity and bytes, and rechecks authority without exposing URLs',async()=>{
 let checks=0,calls=0;
 const api=new TelegramAPI(token,async(input,init)=>{
  calls++;assert.equal(init?.redirect,'manual');assert.ok(init?.signal);
  if(calls===1){assert.deepEqual(JSON.parse(String(init?.body)),{file_id:voice.file_id});return Response.json({ok:true,result:{...voice,file_path:'voice/file_1.oga'}});}
  assert.equal(String(input),'https://api.telegram.org/file/bot'+token+'/voice/file_1.oga');
  return new Response(new Uint8Array([1,2,3]));
 });
 const result=await api.downloadVoice(voice,async()=>{checks++;});
 assert.equal(checks,3);assert.equal(calls,2);assert.deepEqual(result.bytes,new Uint8Array([1,2,3]));
 assert.equal(result.sha256,'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
 assert.deepEqual(result.source,voice);assert.equal(JSON.stringify(result).includes(token),false);
});
test('Voice download rejects substituted identity, paths, oversized streams, redirects and revoked access',async()=>{
 for(const mode of ['identity','path','encoded-path','size','overflow','short','redirect','throw','revoked-before','revoked-after-lookup','revoked-after-download']){
  let calls=0,checks=0;
  const api=new TelegramAPI(token,async(input)=>{
   calls++;
   if(calls===1)return Response.json({ok:true,result:{...voice,
    file_unique_id:mode==='identity'?'other':voice.file_unique_id,
    file_size:mode==='size'?20000001:3,
    file_path:mode==='path'?'../secret':mode==='encoded-path'?'voice/%2e%2e/secret':'voice/test.oga'}});
   if(mode==='throw')throw Error(String(input));
   if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://other.test'}});
   return new Response(new Uint8Array(mode==='overflow'?4:mode==='short'?2:3));
  });
  await assert.rejects(api.downloadVoice(voice,async()=>{
   checks++;if(mode==='revoked-before'&&checks===1||mode==='revoked-after-lookup'&&checks===2||mode==='revoked-after-download'&&checks===3)throw Error(token);
  }),(error:Error)=>{assert.equal(error.message,'Telegram voice download unavailable.');assert.equal(error.cause,undefined);return true;});
  if(mode==='revoked-before')assert.equal(calls,0);
  else if(['identity','path','encoded-path','size','revoked-after-lookup'].includes(mode))assert.equal(calls,1);
  else assert.equal(calls,2);
 }
});
