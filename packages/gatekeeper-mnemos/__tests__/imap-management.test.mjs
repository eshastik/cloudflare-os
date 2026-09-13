import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';
const output=await build({entryPoints:['app/imap-accounts.ts'],bundle:true,platform:'browser',format:'esm',write:false});const {ImapAccountsView}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
test('human account form clears password before IO and recovers a lost acknowledgement by listing saved accounts',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let saved=[],calls=0;
 const api={listImapAccounts:async()=>({servers:[{id:'yandex',title:'Яндекс',host:'imap.yandex.ru',port:993}],accounts:saved}),connectImapAccount:async value=>{calls++;assert.equal(root.querySelector('input[type=password]')?.value??'','');assert.equal(value.password,'private-app-password');assert.equal(value.mailbox,'Team');saved=[{id:value.request,server:value.server,username:value.username,enabled:true,mailbox:'Team'}];throw Error('lost ACK')},removeImapAccount:async id=>{assert.equal(id,saved[0].id);saved=[]}};
 try{const view=new ImapAccountsView(root,api,()=>{});await view.load();root.querySelector('[aria-label="Логин почты"]').value='owner@example.test';root.querySelector('input[type=password]').value='private-app-password';root.querySelector('[aria-label="Папка почты"]').value='Team';[...root.querySelectorAll('button')].find(b=>b.textContent==='Добавить аккаунт почты').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert(!root.innerHTML.includes('private-app-password'));await view.load();assert(root.textContent.includes('Team'));await view.remove(saved[0].id);assert(!root.textContent.includes('Team'));}finally{dom.window.close();delete globalThis.document;}
});

test('SMTP setup clears both passwords and sends only the explicit human sender configuration',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let received;
 const api={listImapAccounts:async()=>({servers:[{id:'apple',title:'iCloud',host:'imap.mail.me.com',port:993}],accounts:[]}),connectImapAccount:async value=>{assert([...root.querySelectorAll('input[type=password]')].every(input=>input.value===''));received=value;return {id:value.request}},removeImapAccount:async()=>{}};
 try{const view=new ImapAccountsView(root,api,()=>{});await view.load();
  for(const [label,value] of [['Логин почты','owner'],['Пароль приложения почты','read-password'],['Адрес отправителя SMTP','owner@icloud.com'],['Логин SMTP (если отличается)','owner@icloud.com'],['Пароль SMTP (если отличается)','send-password']])root.querySelector('[aria-label="'+label+'"]').value=value;
  [...root.querySelectorAll('button')].find(button=>button.textContent==='Добавить аккаунт почты').click();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(received.smtp,{from:'owner@icloud.com',username:'owner@icloud.com',password:'send-password'});assert.equal(received.password,'read-password');assert(!root.innerHTML.includes('send-password'));
 }finally{dom.window.close();delete globalThis.document;}
});
