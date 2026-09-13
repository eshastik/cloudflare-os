import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramInbox, readTelegramMessage, readTelegramInput} from './telegram-inbox.ts';

const secret = 'test_webhook_secret_01234567890123456789';
const owner = {tenant: 'tenant', owner: 'human', bot: '123', binding: 'agent'};
const message = {update: 7, message: 8, sender: 42, text: 'Проверь статус задачи'};
const allow = async () => {};
function fixture() {
  const values = new Map<string, unknown>();
  const storage = {
    get: <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: <T>(key: string, value: T) => { values.set(key, structuredClone(value)); },
    delete: (key: string) => { values.delete(key); },
  };
  const inbox = new TelegramInbox(storage, owner.bot);
  return {storage, inbox, pair() {
    const pairing = inbox.begin(owner);
    assert.equal(inbox.offer({...message, text: '/start ' + pairing.code}), true);
    inbox.confirm(pairing.epoch, message.sender);
    return pairing;
  }};
}
function request(value: unknown, header = secret) {
  return new Request('https://example.test/telegram', {method: 'POST',
    headers: {'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': header},
    body: JSON.stringify(value)});
}
const update = {update_id: 7, message: {message_id: 8, from: {id: 42, is_bot: false}, chat: {id: 42, type: 'private'}, text: message.text}};

test('Webhook authenticates before parsing, bounds payload and ignores non-human/private command channels', async () => {
  assert.deepEqual(await readTelegramMessage(request(update), secret), message);
  await assert.rejects(readTelegramMessage(request(update, 'wrong'), secret), /unavailable/);
  await assert.rejects(readTelegramMessage(request({padding: 'x'.repeat(65537)}), secret), /unavailable/);
  for (const change of [
    {chat: {id: -42, type: 'group'}}, {chat: {id: 43, type: 'private'}},
    {from: {id: 42, is_bot: true}}, {from: {id: '42', is_bot: false}},
    {forward_origin: {type: 'hidden_user'}}, {business_connection_id: 'business'},
    {via_bot: {id: 9}}, {sender_chat: {id: 9}}, {text: 'x'.repeat(16385)},
  ]) assert.equal(await readTelegramMessage(request({...update, message: {...update.message, ...change}}), secret), null);
  assert.equal(await readTelegramMessage(request({update_id: 7, edited_message: update.message}), secret), null);
  await assert.rejects(readTelegramMessage(request({...update, update_id: 1.5}), secret), /unavailable/);
});

test('Pairing needs exact one-use code, human confirmation, expiry and current epoch', async () => {
  const {inbox} = fixture();
  const pairing = inbox.begin(owner, 1000);
  assert.equal(inbox.offer({...message, text: '/start wrong'}, 1001), false);
  assert.equal(inbox.offer({...message, text: '/start ' + pairing.code}, 1001), true);
  assert.equal(inbox.offer({...message, sender: 99, text: '/start ' + pairing.code}, 1002), false);
  await assert.rejects(inbox.accept(message, allow), /unavailable/);
  assert.equal(inbox.candidate(pairing.epoch, 1002), 42);
  assert.throws(() => inbox.confirm(pairing.epoch, 99, 1002), /unavailable/);
  assert.throws(() => inbox.confirm(pairing.epoch, 42, 301000), /unavailable/);
  const next = inbox.begin(owner, 1003);
  assert.throws(() => inbox.confirm(pairing.epoch, 42, 1004), /unavailable/);
  assert.equal(inbox.candidate(next.epoch, 1004), null);
});

test('Two bots/accounts stay isolated, duplicates survive restart, changed payloads never reuse a task', async () => {
  const f = fixture(); f.pair();
  const [a, b] = await Promise.all([f.inbox.accept(message, allow), f.inbox.accept(message, allow)]);
  assert.deepEqual(a, b);
  const restored = new TelegramInbox(f.storage, owner.bot);
  assert.deepEqual(await restored.accept(message, allow), a);
  await assert.rejects(restored.accept({...message, text: 'Подмена'}, allow), /unavailable/);
  await assert.rejects(restored.accept({...message, sender: 99}, allow), /unavailable/);
  await assert.rejects(new TelegramInbox(f.storage, '456').validate(a, allow), /unavailable/);
  const other = fixture(); other.pair();
  await assert.rejects(other.inbox.validate(a, allow), /unavailable/);
  await assert.rejects(restored.validate({...a, scope: {...a.scope, binding: 'another-agent'}}, allow), /unavailable/);
  await restored.validate(a, allow);
  a.text = 'Mutated response';
  assert.equal((await restored.accept(message, allow)).text, message.text);
});

test('Revoked rights and disconnect fence both new input, replay and delayed replies across await', async () => {
  const f = fixture(); f.pair();
  const a = await f.inbox.accept(message, allow);
  const denied = async () => { throw Error('rights revoked'); };
  await assert.rejects(f.inbox.accept(message, denied), /revoked/);
  await assert.rejects(f.inbox.validate(a, denied), /revoked/);
  await assert.rejects(f.inbox.validate(a, async () => { f.inbox.disconnect(); }), /unavailable/);
  f.pair();
  await assert.rejects(f.inbox.validate(a, allow), /unavailable/);
  await assert.rejects(f.inbox.accept(message, async () => { f.inbox.disconnect(); }), /unavailable/);
  f.pair();
  const mutable = {...message};
  const result = await f.inbox.accept(mutable, async () => { mutable.sender = 99; mutable.text = 'changed'; });
  assert.equal(result.sender, 42); assert.equal(result.text, message.text);
});
test('Private reply carries only a locator from the same Telegram chat',async()=>{
 const reply={...update,message:{...update.message,reply_to_message:{message_id:3,chat:{id:42,type:'private'},text:'not trusted as task identity'}}};
 assert.deepEqual(await readTelegramMessage(request(reply),secret),{...message,replyTo:3});
 reply.message.reply_to_message.chat.id=99;
 assert.equal(await readTelegramMessage(request(reply),secret),null);
});


test('Voice envelope uses the same authenticated private-sender boundary and preserves original metadata',async()=>{
 const voice={file_id:'voice_id',file_unique_id:'unique_voice',duration:4,mime_type:'audio/ogg',file_size:3};
 const input={update_id:7,message:{...update.message,text:undefined,voice,caption:'original caption'}};
 assert.deepEqual(await readTelegramInput(request(input),secret),{update:7,message:8,sender:42,voice,caption:'original caption'});
 assert.equal(await readTelegramMessage(request(input),secret),null,'voice must not become an empty text task');
 for(const forward_origin of [{type:'user',sender_user:{id:99,is_bot:false}},{type:'user',sender_user:{id:7389779725,is_bot:true}},{type:'hidden_user',sender_user_name:'Original speaker'}])
  assert.deepEqual(await readTelegramInput(request({...input,message:{...input.message,forward_origin}}),secret),{update:7,message:8,sender:42,voice,caption:'original caption'},'forwarded audio belongs to the current sender, not its original author');
 await assert.rejects(readTelegramInput(request(input,'wrong'),secret));
 for(const change of [{chat:{id:-1,type:'group'}},{from:{id:42,is_bot:true}},
  {text:'ambiguous'},{voice:{...voice,file_size:20000001}},{voice:{...voice,duration:-1}},{voice:{...voice,file_id:'../other'}}])
  assert.equal(await readTelegramInput(request({...input,message:{...input.message,...change}}),secret),null);
});
