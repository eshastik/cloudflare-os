import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {GitRegistrations} from "./src/git-registration.ts";export {GitConnectionsView} from "./app/git-connections.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {GitRegistrations,GitConnectionsView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const setup={provider:'github',api_base:'https://api.github.com',name:'Company'};
const connection=id=>({connection_id:id,owner_id:'owner',...setup,account_id:'7',account_login:'alice',revision:1,enabled:true});
function storage(){const rows=new Map();return {get:k=>structuredClone(rows.get(k)),put:(k,v)=>rows.set(k,structuredClone(v)),dump:()=>JSON.stringify([...rows])};}
test('Git registration keeps only metadata and recovers committed unknown response without replay',async()=>{
 const store=storage();let journal=new GitRegistrations(store),calls=0,result;const api={listGitConnections:async()=>({connections:[]}),registerGitConnection:async input=>{calls++;result=connection(input.connection_id);assert.equal(input.token,'external-secret');throw Error('lost response');},readGitConnection:async id=>{assert.equal(id,result.connection_id);return result;}};
 const saved=await journal.save(api,setup);await assert.rejects(()=>journal.execute(api,saved.id,'external-secret',false));assert.equal(calls,1);assert(!store.dump().includes('external-secret'));
 journal=new GitRegistrations(store);assert.equal((await journal.list(api))[0].attempted,true);await assert.rejects(()=>journal.execute(api,saved.id,'external-secret',false));assert.equal(calls,1);
 const recovered=await journal.inspect(api,saved.id);assert.equal(recovered.account_id,'7');assert.equal((await journal.list(api))[0].completed,true);await journal.execute(api,saved.id,'',false);assert.equal(calls,1);
 await assert.rejects(()=>journal.save(api,{...setup,token:'must-not-persist'}));assert(!store.dump().includes('must-not-persist'));
});
test('Git journal retains independent unknown requests and rejects receipt substitution',async()=>{
 const store=storage(),journal=new GitRegistrations(store);let sent=[];const api={listGitConnections:async()=>({connections:[]}),registerGitConnection:async input=>{sent.push(input.connection_id);throw Error('unknown');},readGitConnection:async()=>connection('wrong')};
 const first=await journal.save(api,setup);await assert.rejects(()=>journal.execute(api,first.id,'token-a',false));
 const second=await journal.save(api,{...setup,name:'Another account'});assert.notEqual(second.id,first.id);assert.equal((await journal.list(api)).length,2);
 await assert.rejects(()=>journal.execute(api,first.id,'token-a',true));assert.deepEqual(sent,[first.id,first.id]);await assert.rejects(()=>journal.inspect(api,first.id));assert.equal((await journal.list(api))[0].completed,false);assert(!store.dump().includes('token-a'));
});
test('Git UI clears the password on submit, renders text safely and permits revoke with provider down',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let entry={id:'saved',setup,attempted:false,completed:false},c={...connection('saved'),name:'<img src=x onerror=alert(1)>'},release,disabled=0;
 const api={listGitConnections:async()=>({connections:[c]}),listGitRegistrationIntents:async()=>[entry],readGitConnection:async()=>c,listGitRepositories:async()=>{throw Error('provider down');},executeGitRegistrationIntent:async(id,token,retry)=>{assert.equal(token,'secret-in-form');assert.equal(retry,false);await new Promise(resolve=>release=resolve);entry={...entry,completed:true};return c;},disableGitConnection:async(id,revision)=>{assert.equal(id,'saved');assert.equal(revision,1);disabled++;c={...c,revision:2,enabled:false};return {connection:c,credential_removed:true};}};
 const view=new GitConnectionsView(root,api,()=>{});await view.load();const click=label=>{const b=[...root.querySelectorAll('button')].find(e=>e.textContent===label);assert(b,label);b.click();};
 click('Проверить заявку: Company — saved');const input=root.querySelector('input[type=password]');input.value='secret-in-form';click('Отправить ключ и подключить');assert.equal(input.value,'');assert(!root.textContent.includes('secret-in-form'));release();await new Promise(resolve=>setTimeout(resolve,0));
 await view.open('saved');assert(root.textContent.includes('Каталог недоступен'));assert.equal(root.querySelector('img'),null);click('Отключить подключение…');assert.equal(disabled,0);await view.confirmDisable();assert.equal(disabled,1);assert(root.textContent.includes('ключ удалён'));
});
test('Git UI re-enables a disabled binding using its current revision and requires confirmation',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const writes=[];let fail=false;
 const api={listProjectGitRepositories:async(project,cursor)=>{assert.equal(project,'project');assert.equal(cursor,'');return {repositories:[]};},readOwnedGitBinding:async(project,connection,repository)=>{assert.deepEqual([project,connection,repository],['project','connection','10']);if(fail)throw Error('access revoked');return {connection_revision:3,binding:{project_id:project,connection_id:connection,repository_id:repository,repository_name:'team/old-name',revision:2,enabled:false}};},bindGitRepository:async(...args)=>{writes.push(args);}};
 const view=new GitConnectionsView(root,api,()=>{},[{id:'project',name:'Project'}]);await view.loadProject('project');await view.prepareBinding('project','connection','10','team/code',true);assert.equal(writes.length,0);assert(root.textContent.includes('Подтвердить привязку'));
 await view.confirmBinding();assert.deepEqual(writes,[['project','connection','10',{expected_connection_revision:3,expected_revision:2,repository_name:'team/code',enabled:true}]]);
 await view.prepareBinding('project','connection','10','team/code',false);fail=true;await view.prepareBinding('project','connection','10','team/code',true);await view.confirmBinding();assert.equal(writes.length,1);assert(!root.textContent.includes('Подтвердить привязку'));
});
test('Git UI retains exact commit coordinates, renders message as text, and clears it after denial',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const sha='a'.repeat(40);let allowed=true;
 const api={readGitCommit:async(...args)=>{assert.deepEqual(args,['project','connection','10','feature/context']);if(!allowed)throw Error('revoked');return {repository_id:'10',sha,message:'<img src=x> external message',committed_at:'2026-09-09T10:00:00Z',parents:[]};}};
 const view=new GitConnectionsView(root,api,()=>{});await view.readCommit('project','connection','10','feature/context');assert(root.textContent.includes(sha));assert(root.textContent.includes('подключение connection'));assert.equal(root.querySelector('img'),null);
 allowed=false;await view.readCommit('project','connection','10','feature/context');assert(!root.textContent.includes(sha));assert(!root.textContent.includes('external message'));
});
test('Git UI reads a file at the resolved SHA and clears it when the next read is denied',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const sha='a'.repeat(40);let allowed=true;
 const api={readGitCommit:async()=>({repository_id:'10',sha,message:'commit',committed_at:'2026-09-09T10:00:00Z',parents:[]}),readGitFile:async(...args)=>{assert.deepEqual(args,['project','connection','10',sha,'src/code.ts']);if(!allowed)throw Error('revoked');return {repository_id:'10',commit_sha:sha,path:'src/code.ts',blob_sha:'b'.repeat(40),sha256:'c'.repeat(64),size_bytes:15,content:'<img src=x> code'};}};
 const view=new GitConnectionsView(root,api,()=>{});await view.readCommit('project','connection','10','main');await view.readFile('src/code.ts');assert(root.textContent.includes('<img src=x> code'));assert.equal(root.querySelector('img'),null);
 allowed=false;await view.readFile('src/code.ts');assert(!root.textContent.includes('<img src=x> code'));assert(!root.textContent.includes(sha));
});
