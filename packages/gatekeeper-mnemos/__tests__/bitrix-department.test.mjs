import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const built=await build({stdin:{contents:'export {BitrixDepartmentView} from "./app/bitrix-department.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const {BitrixDepartmentView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const source={project:'project',node:'node',head:'head',sha256:'hash',person:'10',department:'2'};
const selection={source_sha256:'hash',person_id:'10',department_id:'2',role_id:'role',member_id:'human'};
function setup(api){const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');return {root,view:new BitrixDepartmentView(root,api,source,()=>{})};}
function state(){return {person_name:'<img src=x>',department_name:'Department',source_person_active:true,membership:{member_id:'human',member_name:'Human',container_id:'role',container_name:'Role',member_active:true,container_active:true,enabled:false,generation:8}};}
test('Department import binds displayed source and identities; lost reply cannot repeat the mutation',async()=>{
 const value=state();let writes=0;
 const {root,view}=setup({previewBitrixDepartmentMembership:async(...args)=>{assert.deepEqual(args,['project','node','head',selection]);return structuredClone(value)},applyBitrixDepartmentMembership:async(...args)=>{writes++;assert.deepEqual(args,['project','node','head',selection,{expected_generation:8,expected_enabled:false,enabled:true}]);value.membership.enabled=true;value.membership.generation=9;throw Error('response lost')}});
 await view.preview('role','human');assert.equal(root.querySelector('img'),null);assert(root.textContent.includes('в других проектах'));await view.apply(true);await view.apply(true);assert.equal(writes,1);assert(!root.textContent.includes('Подтвердить добавление в роль'));await view.preview();assert(root.textContent.includes('Удалить сопоставленное членство'));
});
test('Changing a target removes the old decision; closing prevents delayed private output',async()=>{
 let resolve;const {root,view}=setup({previewBitrixDepartmentMembership:()=>new Promise(r=>resolve=r)});
 let pending=view.preview('role','human');resolve(state());await pending;
 const input=root.querySelector('[aria-label="ID пользователя Mnemos"]');input.value='different';input.dispatchEvent(new input.ownerDocument.defaultView.Event('input'));assert.equal(root.querySelector('[data-department-decision]'),null);
 pending=view.preview();[...root.querySelectorAll('button')].find(b=>b.textContent==='Вернуться к выгрузке').click();resolve(state());await pending;assert.equal(root.textContent,'');
});
