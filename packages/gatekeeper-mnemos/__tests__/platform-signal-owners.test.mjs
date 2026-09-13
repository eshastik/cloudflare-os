import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {PlatformSignalOwnersView} from "./app/platform-signal-owners.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const {PlatformSignalOwnersView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const page=()=>({generation:7,owners:[{signal_key:'external.read',owner_id:'user',owner_name:'<img src=x>',owner_active:true,revision:3}]});
function setup(api){const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');return {root,view:new PlatformSignalOwnersView(root,api,()=>{})};}
test('an unconfirmed assignment requires rereading and cannot silently retry',async()=>{
 let writes=0;const {root,view}=setup({listPlatformSignalOwners:async()=>page(),setPlatformSignalOwner:async(key,decision)=>{writes++;assert.equal(key,'external.read');assert.deepEqual(decision,{owner_id:'next',expected_generation:7,expected_revision:3});throw Error('response lost')}});
 await view.read();assert.equal(root.querySelector('img'),null);await view.set('external.read','next',3);await view.set('external.read','next',3);assert.equal(writes,1);assert(root.textContent.includes('Назначение не подтверждено'));assert.equal(root.querySelector('input'),null);
});
test('closing an in-flight catalog prevents later private output',async()=>{
 let resolve;const {root,view}=setup({listPlatformSignalOwners:()=>new Promise(r=>resolve=r)});const pending=view.read();[...root.querySelectorAll('button')].find(x=>x.textContent==='Закрыть ответственных').click();resolve(page());await pending;assert.equal(root.textContent,'');
});
