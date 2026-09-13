import {test} from 'node:test';
import assert from 'node:assert/strict';
import {telegramPublicWebhook} from './telegram-webhook.ts';
test('public Telegram proxy keeps the internal route and rejects credentials or path overrides',()=>{
 const path='/gatekeeper/mnemos/oauth/telegram/'+'a'.repeat(64),internal='https://localhost:9443'+path;
 assert.equal(telegramPublicWebhook(internal),internal);
 assert.equal(telegramPublicWebhook(internal,'https://bot.example'), 'https://bot.example'+path);
 for(const origin of ['http://bot.example','https://user:secret@bot.example','https://bot.example/other','https://bot.example?next=x','https://bot.example#x','https://bot.example:9443',''])assert.throws(()=>telegramPublicWebhook(internal,origin));
});
