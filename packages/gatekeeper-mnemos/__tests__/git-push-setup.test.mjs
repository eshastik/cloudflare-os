import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {MnemosAPI} from "./src/mnemos-api.ts";export {GitConnectionsView} from "./app/git-connections.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {MnemosAPI,GitConnectionsView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const path='/git-push/'+Buffer.from(JSON.stringify(['project','connection','10'])).toString('base64url');
const state=()=>({connection_revision:1,binding:{project_id:'project',connection_id:'connection',repository_id:'10',repository_name:'team/code',revision:1,enabled:true},push_path:path,push_url:'https://foreign.invalid/steal',mcp_resource:'https://foreign.invalid/mcp'});
test('push setup derives only a matching route on the configured Mnemos origin',async()=>{
 let value=state();const api=new MnemosAPI('https://memory.example',async()=>'human-token',async(url,init)=>{
  assert.equal(String(url),'https://memory.example/v1/projects/project/git/connection/repositories/10/binding');assert.equal(init.method,'GET');return Response.json(value);
 });
 const result=await api.readOwnedGitBinding('project','connection','10');
 assert.equal(result.push_url,'https://memory.example'+path);assert.equal(result.mcp_resource,'https://memory.example/mcp');
 for(const mutate of [v=>v.push_path='https://foreign.invalid/x',v=>v.push_path='/git-push/'+Buffer.from(JSON.stringify(['other','connection','10'])).toString('base64url'),v=>v.push_path='/git-push/malformed',v=>v.binding.enabled=false,v=>v.binding.repository_id='11']){
  value=state();mutate(value);await assert.rejects(()=>api.readOwnedGitBinding('project','connection','10'));
 }
 value=state();delete value.push_path;const absent=await api.readOwnedGitBinding('project','connection','10');assert.equal(absent.push_url,undefined);assert.equal(absent.mcp_resource,undefined);
});
test('Git panel obtains setup from the owned binding and clears it after refusal',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let allowed=true;
 const api={readOwnedGitBinding:async(...args)=>{assert.deepEqual(args,['project','connection','10']);if(!allowed)throw Error('revoked');return {...state(),push_url:'https://memory.example'+path,mcp_resource:'https://memory.example/mcp'};}};
 const view=new GitConnectionsView(root,api,()=>{});await view.preparePush('project','connection','10');assert(root.textContent.includes('https://memory.example'+path));assert(root.textContent.includes('https://memory.example/mcp'));
 allowed=false;await view.preparePush('project','connection','10');assert(!root.textContent.includes(path));assert(!root.textContent.includes('https://memory.example/mcp'));
});
