import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {PolicyAlertsView} from "./app/policy-alerts.ts";export {validPolicyAlertPage} from "./src/policy-alerts.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {PolicyAlertsView,validPolicyAlertPage}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const id='a'.repeat(32),page=()=>({alerts:[{id,kind:'inbox',resource:'opaque',source_path:'<script>private-path</script>',policy_class:'personal',reason:'ask-human',raised_at:'2026-09-13T00:00:00Z'}],next:id,truncated:false});
function setup(api){const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');return {root,view:new PolicyAlertsView(root,api,()=>{}),close:()=>[...root.querySelectorAll('button')].find(b=>b.textContent==='Закрыть предупреждения').click()};}
test('operator reviews only explicitly, renders paths as text and clears data on denied reload',async()=>{
 let reviewed=false,deny=false,calls=0;const a=setup({policyAlerts:async()=>{if(deny)throw Error('403');const p=page();if(reviewed)p.alerts=[];return p},reviewPolicyAlert:async(key,note)=>{assert.equal(key,id);assert.equal(note,'Проверено');reviewed=true;calls++;return {reviewed:true}}});
 await a.view.load();assert.equal(calls,0);assert.equal(a.root.querySelector('script'),null);
 await a.view.review(id,'Проверено');assert.equal(calls,1);assert.match(a.root.textContent,/Рассмотрение записано/);
 reviewed=false;await a.view.load();deny=true;await a.view.load();assert.doesNotMatch(a.root.textContent,/private-path/);a.close();
});
test('lost review response is not retried automatically; closed view ignores late response',async()=>{
 let calls=0;const a=setup({policyAlerts:async()=>page(),reviewPolicyAlert:async()=>{calls++;throw Error('response lost')}});await a.view.load();await a.view.review(id,'note');assert.equal(calls,1);assert.match(a.root.textContent,/Не удалось подтвердить/);a.close();
 let resolve;const b=setup({policyAlerts:()=>new Promise(r=>resolve=r)});const pending=b.view.load();b.close();resolve(page());await pending;assert.equal(b.root.textContent,'');
});
test('page validator rejects duplicate IDs and broken pagination; empty review note is supported',()=>{
 assert(validPolicyAlertPage(page()));const p=page();p.alerts[0].reviewed_at='2026-09-13T00:01:00Z';p.alerts[0].reviewed_by='operator';assert(validPolicyAlertPage(p));
 p.alerts.push({...p.alerts[0]});assert(!validPolicyAlertPage(p));const bad=page();bad.truncated=true;bad.next='b'.repeat(32);assert(!validPolicyAlertPage(bad));
});
