import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {RoleMembershipView} from "./app/role-membership.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const {RoleMembershipView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('Role decision uses displayed identities and generation; a lost response requires a fresh read',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let reads=0,writes=0;
 const state={container_id:'role',container_name:'<img src=x>',container_kind:'functional_role',container_active:true,member_id:'person',member_name:'Person',member_kind:'user',member_active:true,generation:8,enabled:false};
 const view=new RoleMembershipView(root,{readPrincipalMembership:async()=>{reads++;return {...state}},setPrincipalMembership:async(...args)=>{writes++;assert.deepEqual(args,['role','person',{expected_generation:8,expected_enabled:false,enabled:true}]);state.generation=9;state.enabled=true;throw Error('response lost')}},()=>{});
 await view.load('role','person');assert.equal(root.querySelector('img'),null);assert(root.textContent.includes('других проектах'));await view.change(true);assert.equal(writes,1);assert(!root.textContent.includes('Добавить участника в роль'));await view.change(true);assert.equal(writes,1);await view.load('role','person');assert.equal(reads,2);assert(root.textContent.includes('Удалить участника из роли'));
});
test('Closing role management with a pending read does not render the private result',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let resolve;const view=new RoleMembershipView(root,{readPrincipalMembership:()=>new Promise(r=>resolve=r)},()=>{});const pending=view.load('role','person');[...root.querySelectorAll('button')].find(b=>b.textContent==='Закрыть состав ролей').click();resolve({container_name:'Private role'});await pending;assert.equal(root.textContent,'');
});
test('Role creation uses the catalog generation and requires rereading after a lost response',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let writes=0;const roles=[];
 const view=new RoleMembershipView(root,{listOrganizationRoles:async()=>({roles:[...roles],next_cursor:'',generation:12}),createOrganizationRole:async(input)=>{writes++;assert.deepEqual(input,{id:'new-role',kind:'functional_role',name:'Department',expected_generation:12});roles.push({id:'new-role',kind:'functional_role',name:'Department',active:true});throw Error('response lost')}},()=>{});
 await view.list();await view.create('new-role','functional_role','Department');assert.equal(writes,1);assert(!root.textContent.includes('Создать роль без прав'));await view.create('new-role','functional_role','Department');assert.equal(writes,1);await view.list();assert(root.textContent.includes('Department (new-role)'));
});
