import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {DatabaseConnectionsView} from "./app/database-connections.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const {DatabaseConnectionsView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('DB setup requires confirmation and distinguishes saved metadata from an available credential',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let writes=0,allowed=true;const input={name:'reports',driver:'postgres',env_var:'MNEMOS_DB_REPORTS',max_rows:20,timeout_ms:3000};
 const api={listDatabaseConnections:async project=>{assert.equal(project,'project');if(!allowed)throw Error('denied');return {databases:[]};},registerDatabaseConnection:async(project,body)=>{assert.equal(project,'project');assert.deepEqual(body,input);writes++;return {database:{configured:false}};}};
 const view=new DatabaseConnectionsView(root,api,[{id:'project',name:'Project'}],()=>{});await view.load('project');view.prepare({...input,max_rows:NaN});assert(!root.textContent.includes('Подтвердить настройку БД'));view.prepare(input);assert.equal(writes,0);await view.confirm();assert.equal(writes,1);assert(root.textContent.includes('ключ для этого проекта недоступен'));
 view.prepare(input);allowed=false;await view.load('project');await view.confirm();assert.equal(writes,1);assert(!root.textContent.includes('Подтвердить настройку БД'));
});
test('DB removal uses selected project and name without rendering external text as HTML',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let removed=false;const name='<img src=x>';
 const api={listDatabaseConnections:async()=>({databases:removed?[]:[{name,driver:'postgres',env_var:'MNEMOS_DB_TEST',configured:true,registered_by:'owner',registered_at:'today'}]}),removeDatabaseConnection:async(project,selected)=>{assert.deepEqual([project,selected],['project',name]);removed=true;return {removed:true};}};
 const view=new DatabaseConnectionsView(root,api,[{id:'project',name:'Project'}],()=>{});await view.load('project');assert.equal(root.querySelector('img'),null);[...root.querySelectorAll('button')].find(b=>b.textContent===`Снять подключение: ${name}`).click();assert(!removed);await view.confirm();assert(removed);assert(root.textContent.includes('Подключение снято'));
});
test('DB-only access discovers connections without filesystem project visibility',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let opened='';const api={listVisibleDatabaseConnections:async()=>({databases:[{name:'reports',project_id:'db-only'}],truncated:false}),listDatabaseConnections:async project=>{opened=project;return {databases:[]};}};
 const view=new DatabaseConnectionsView(root,api,[],()=>{});await view.discover();[...root.querySelectorAll('button')].find(b=>b.textContent==='Открыть reports · проект db-only').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(opened,'db-only');assert(root.textContent.includes('Настроить подключение PostgreSQL'));
});
