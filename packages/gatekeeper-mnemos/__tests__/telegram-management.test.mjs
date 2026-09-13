import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['app/telegram.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {TelegramView}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('Telegram catalogue restores selection without a token and clears on failure or close',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let fail=false,resolve;
 const selected=[];const api={listTelegram:async()=>{if(fail)throw Error('revoked');return {connections:[{bot:'123',username:'mine',binding:'agent',ready:true,disconnected:false,cleanup_pending:false,channel_registered:true},{bot:'456',username:'old',binding:'agent',ready:false,disconnected:true,cleanup_pending:false,channel_registered:false}],unavailable:1}},describeTelegram:async bot=>{selected.push(bot);return {bot,username:'mine',channel_id:null,channel_registered:true,disconnected:false,candidate:null}}};
 const view=new TelegramView(root,api,()=>{});await view.list();
 assert.match(root.textContent,/@mine · 123 — подключён/);assert.match(root.textContent,/@old · 456 — отключён/);assert.match(root.textContent,/Не удалось прочитать подключений: 1/);
 [...root.querySelectorAll('button')].find(b=>b.textContent.startsWith('@mine')).click();await new Promise(r=>setImmediate(r));assert.deepEqual(selected,['123']);assert.match(root.textContent,/Канал подключён/);
 fail=true;await view.list();assert(!root.textContent.includes('@mine'));assert(!root.textContent.includes('Канал подключён'));
 api.listTelegram=()=>new Promise(r=>{resolve=r});const pending=view.list();[...root.querySelectorAll('button')].find(b=>b.textContent==='Закрыть Telegram').click();resolve({connections:[],unavailable:0});await pending;assert.equal(root.textContent,'');dom.window.close();delete globalThis.document;
});
test('Human Telegram setup pins consent and sender, renders source as text, and cleans up',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 let state={bot:'123',username:'fixture',binding:'agent',ready:true,disconnected:false,cleanup_pending:false,channel_id:null,channel_registered:false,epoch:'epoch',candidate:42,sender:null,expires:Date.now()+60000,code:'pairing'};
 const connects=[];const pages=[];let closed=false;
 const api={telegramLocalInbox:async(id,after)=>{assert.equal(id,'channel');assert.equal(after,-1);return {available:true,items:[{update_id:99,message:'Not yet submitted <script>',kind:'task',target_update_id:99,state:{queue:'pending'}}],next_after:null};},listAgentConnections:async()=>({connections:[{binding_id:'agent',agent_principal_id:'my-agent',managed_runtime:true,revoked:false}]}),
 connectTelegram:async(...args)=>{connects.push(args);assert.equal(args[3],true);return {...state};},
 describeTelegram:async id=>{assert.equal(id,'123');return {...state};},
 confirmTelegram:async(...args)=>{assert.deepEqual(args,['123','epoch',42]);state={...state,channel_id:'channel',channel_registered:true,sender:42,candidate:null,code:null};return {...state};},
 disconnectTelegram:async id=>{assert.equal(id,'123');state={...state,disconnected:true,channel_registered:false};},
 telegramTaskJournal:async(id,after)=>{assert.equal(id,'channel');pages.push(after);return {channel:{},delivery:[{update_id:after+2,request_id:'task',queue:'done',execution:after===-1?'completed':null,correction:after===-1?null:'queued',delivery:[{phase:after===-1?'completed':'correction',state:after===-1?'uncertain':'delivered'}]}],items:[{kind:after===-1?'task':'correction',target_update_id:1,update_id:after+2,request_id:'task',message:'<img src=x onerror=alert(1)>'}],next_after:after===-1?1:null};}};
 const view=new TelegramView(root,api,()=>{closed=true;});view.render();
 const fill=(label,value)=>{const input=root.querySelector('input[aria-label="'+label+'"]');input.value=value;input.dispatchEvent(new dom.window.Event('input'));};
 const click=label=>[...root.querySelectorAll('button')].find(b=>b.textContent===label).click();
 fill('Токен BotFather','123:synthetic-secret');await view.agentsPage();click('my-agent');
 const check=root.querySelector('input[type=checkbox]');check.checked=true;check.dispatchEvent(new dom.window.Event('change'));
 await view.connect();assert.equal(connects.length,1);assert.equal(connects[0][1],'123:synthetic-secret');assert.equal(connects[0][2],'agent');assert(!root.innerHTML.includes('synthetic-secret'));
 await view.confirm();assert.match(root.textContent,/Канал подключён/);
 await view.history();await view.history(true);assert.deepEqual(pages,[-1,1]);assert.equal(root.querySelector('img'),null);assert.match(root.textContent,/<img/);assert.match(root.textContent,/Корректировка 3 к сообщению 1/);assert.match(root.textContent,/Задача завершена/);assert.match(root.textContent,/доставка не подтверждена/);assert.match(root.textContent,/Корректировка принята в очередь/);
 await view.localHistory();assert.match(root.textContent,/Not yet submitted/);assert.match(root.textContent,/Ожидает обработки/);assert.equal(root.querySelector('script'),null);
 await view.disconnect();assert.match(root.textContent,/Бот отключён/);
 click('Закрыть Telegram');assert(closed);assert.equal(root.textContent,'');
 dom.window.close();delete globalThis.document;
});

test('Telegram budget form preserves exact USD, uses fetched policy and requires consent',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const writes=[];
 const api={describeTelegram:async()=>({bot:'123',username:'bot',channel_id:'channel',channel_registered:true,disconnected:false,candidate:null}),
 readTelegramBudget:async()=>({revision:0,project_id:'',policy_revision:0,limit_usd_micros:'0'}),
 readProjectBudget:async project=>({project_id:project,revision:7,limit_usd_micros:'9007199254740993',automatic_usd_micros:'1000',automatic_team_size:1}),
 setTelegramBudget:async(...args)=>{writes.push(args);return {revision:1,...args[2]};}};
 const view=new TelegramView(root,api,()=>{});view.render();
 const fill=(label,value)=>{const e=root.querySelector('input[aria-label="'+label+'"]');e.value=value;e.dispatchEvent(new dom.window.Event('input'));};
 fill('ID бота','123');await view.load();await view.loadBudget();fill('ID проекта бюджета','project');await view.loadPolicy();
 fill('Лимит на сообщение, USD','9007199254.740993');await view.saveBudget();assert.equal(writes.length,0);
 fill('Подключение агента распознавания Telegram','voice-agent');fill('Лимит распознавания Telegram, USD','0.123456');
 const consent=root.querySelector('input[aria-label="Подтверждаю бюджет новых сообщений"]');consent.checked=true;consent.dispatchEvent(new dom.window.Event('change'));
 await view.saveBudget();assert.deepEqual(writes,[['channel',0,{project_id:'project',policy_revision:7,limit_usd_micros:'9007199254740993',voice_binding_id:'voice-agent',voice_limit_usd_micros:'123456'},true]]);
 assert.match(root.textContent,/9007199254.740993 USD/);assert.match(root.textContent,/Настройка сохранена/);
 dom.window.close();delete globalThis.document;
});
