import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://ui.example'});
for(const key of ['window','document','HTMLElement','Node','MutationObserver'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const channels=[]; const OriginalMessageChannel=globalThis.MessageChannel;
globalThis.MessageChannel=class extends OriginalMessageChannel {constructor(){super();channels.push(this);}};
const bundle=await build({stdin:{contents:'export {default as PeopleTab} from "./app-react/PeopleTab.tsx"; export {HostProvider} from "./app-react/host.ts"; export {createElement,act} from "react"; export {createRoot} from "react-dom/client";',resolveDir:process.cwd()},bundle:true,jsx:'automatic',platform:'node',format:'esm',write:false,define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'ui-controls',setup(b){b.onResolve({filter:/^@cloudflare\/kumo$/},()=>({path:'controls',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'import {createElement} from "react"; export function Button({variant,size,...props}){return createElement("button",props)};export function Empty(){return null}',resolveDir:process.cwd()}));}}]});
const {PeopleTab,HostProvider,createElement:h,act,createRoot}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const admin={identity:{subject:{tenant_id:'t',user_id:'owner'},capabilities:['principal.manage']},projects:[]};
async function render(ui,props=admin){const el=document.createElement('div');document.body.append(el);const root=createRoot(el);await act(async()=>{root.render(h(HostProvider,{value:{ui,host:{ui}}},h(PeopleTab,{data:props})));});await act(async()=>{await new Promise(r=>setTimeout(r,0));});return {el,async close(){await act(async()=>root.unmount());el.remove();}};}
const find=(el,text)=>[...el.querySelectorAll('button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text);
async function click(el,text){const button=find(el,text);assert.ok(button,text);await act(async()=>button.click());await act(async()=>{await new Promise(r=>setTimeout(r,0));});}
async function type(el,label,value){const input=[...el.querySelectorAll('label')].find(l=>l.textContent.startsWith(label))?.querySelector('input,select')??el.querySelector(`[aria-label="${label}"]`);assert.ok(input,label);await act(async()=>{const proto=input.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
const units=[{org_unit_id:'unit-sales',name:'Продажи',members:[{principal_id:'head',display_name:'Ольга',is_head:true},{principal_id:'ivan',display_name:'Иван',is_head:false}]}];

test('администратор приглашает сразу в отдел и с ролью; приглашённый виден в списке людей без идентификаторов',async()=>{
 const created=[];let invitations=[];
 const ui={listPeople:async()=>({users:[]}),listOrgUnits:async()=>units,listInvitations:async()=>invitations,
  createInvitation:async(email,name,unit,role)=>{created.push([email,name,unit,role]);const invitation={invitation_id:'inv-1',email,display_name:name,org_unit_id:unit,org_unit_name:'Продажи',role,created_by:'owner',created_by_name:'Анна',created_at:'2026-09-24T10:00:00Z',expires_at:'2026-10-01T10:00:00Z',status:'open',email_status:'sent'};invitations=[invitation];return {invitation,link:'https://os.example/gatekeeper/mnemos/oauth/invite/'+'c'.repeat(43)};},
  revokeInvitation:async id=>{invitations=invitations.map(i=>i.invitation_id===id?{...i,status:'revoked'}:i);return invitations[0];}};
 const view=await render(ui);
 await click(view.el,'Пригласить');
 await type(view.el,'Почта','new@company.ru');await type(view.el,'Имя','Пётр');await type(view.el,'Отдел приглашения','unit-sales');
 const roles=[...view.el.querySelector('[aria-label="Роль приглашённого"]').options].map(o=>o.textContent);
 assert.deepEqual(roles,['Сотрудник','Руководитель отдела','Администратор'],'администратору доступны все три роли');
 await type(view.el,'Роль приглашённого','head');
 await click(view.el,'Отправить приглашение');
 assert.deepEqual(created,[['new@company.ru','Пётр','unit-sales','head']]);
 assert.match(view.el.textContent,/руководитель отдела/,'роль в списке приглашений словами');
 assert.match(view.el.textContent,/Письмо со ссылкой отправлено на new@company\.ru/,'статус письма');
 assert.equal(view.el.querySelector('input[aria-label="Ссылка-приглашение"]').value,'https://os.example/gatekeeper/mnemos/oauth/invite/'+'c'.repeat(43));
 assert.match(view.el.textContent,/ждёт входа/);assert.match(view.el.textContent,/отдел «Продажи»/);
 assert.ok(view.el.querySelector('section[aria-label="Люди"] [data-invitation]'),'приглашённый — строкой в списке людей');
 assert.equal(view.el.querySelector('[data-admin-details]'),null,'«Подробнее» с идентификаторами нет');assert.doesNotMatch(view.el.textContent,/inv-1/);
 await click(view.el,'Отозвать приглашение: Пётр');assert.match(view.el.textContent,/Приглашение для Пётр отозвано/);
 assert.equal(view.el.querySelector('[data-invitation]'),null,'отозванное приглашение ушло из списка');
 await view.close();
});

test('администратор ведёт отделы: создать, раскрыть, добавить сотрудника, назначить руководителя, убрать, удалить с итогом',async()=>{
 const calls=[];let list=structuredClone(units);
 const ui={listPeople:async()=>({users:[{userName:'ivan',displayName:'Иван',active:true},{userName:'maria',displayName:'Мария',active:true}]}),listOrgUnits:async()=>list,listInvitations:async()=>[],
  createOrgUnit:async name=>{calls.push(['create',name]);const unit={org_unit_id:'unit-new',name,members:[]};list=[...list,unit];return unit;},
  setOrgUnitMember:async(unit,who,member,head)=>{calls.push([unit,who,member,head]);},
  deleteOrgUnit:async unit=>{calls.push(['delete',unit]);list=list.filter(u=>u.org_unit_id!==unit);return {deleted:true,projects_made_private:3,requests_closed:1,invitations_revoked:0,members_removed:5};}};
 const view=await render(ui);
 await act(async()=>{await new Promise(r=>setTimeout(r,0));});
 assert.match(view.el.textContent,/Продажи/);
 await type(view.el,'Новый отдел','Склад');await click(view.el,'Создать отдел');
 await click(view.el,'Продажи');
 assert.match(view.el.textContent,/Руководитель/,'состав раскрылся на месте');
 await type(view.el,'Добавить в отдел Продажи','maria');await click(view.el,'Добавить в отдел');
 await click(view.el,'Сделать руководителем');
 await click(view.el,'Убрать из отдела: Иван');
 await click(view.el,'Удалить отдел');
 const confirm=view.el.querySelector('[aria-label="Удаление отдела Продажи"]');
 assert.match(confirm.textContent,/станут видны только их создателям/);assert.match(confirm.textContent,/останутся в организации без отдела/);
 await click(view.el,'Удалить');
 assert.deepEqual(calls,[['create','Склад'],['unit-sales','maria',true,false],['unit-sales','ivan',true,true],['unit-sales','ivan',false,false],['delete','unit-sales']]);
 assert.match(view.el.textContent,/Отдел «Продажи» удалён\. 3 проекта стали личными, 5 сотрудников остались без отдела/);
 await view.close();
});

test('отмена удаления отдела ничего не удаляет',async()=>{
 const calls=[];const ui={listPeople:async()=>({users:[]}),listOrgUnits:async()=>units,listInvitations:async()=>[],deleteOrgUnit:async u=>{calls.push(u);}};
 const view=await render(ui);await act(async()=>{await new Promise(r=>setTimeout(r,0));});
 assert.ok([...view.el.querySelectorAll('button')].some(b=>b.textContent==='Удалить отдел'),'кнопка видна без раскрытия отдела');
 await click(view.el,'Удалить отдел');await click(view.el,'Отмена');
 assert.equal(view.el.querySelector('[aria-label="Удаление отдела Продажи"]'),null);assert.deepEqual(calls,[]);
 await view.close();
});

test('руководитель отдела без полномочия приглашает только в свой отдел; остальным раздел закрыт',async()=>{
 const created=[];
 const ui={listOrgUnits:async()=>units,listInvitations:async()=>[],createInvitation:async(email,name,unit)=>{created.push(unit);return {invitation:{invitation_id:'inv',email,display_name:name,created_by:'head',created_by_name:'Ольга',created_at:'',expires_at:'',status:'open'},link:'https://os.example/x'};}};
 const head=await render(ui,{identity:{subject:{tenant_id:'t',user_id:'head'},capabilities:[]},projects:[]});
 assert.match(head.el.textContent,/Отдел «Продажи»/);
 const select=head.el.querySelector('[aria-label="Отдел приглашения"]');assert.deepEqual([...select.options].map(o=>o.value),['unit-sales'],'без «Без отдела» и чужих отделов');
 assert.deepEqual([...head.el.querySelector('[aria-label="Роль приглашённого"]').options].map(o=>o.value),['employee','head'],'руководитель не приглашает администраторов');
 await type(head.el,'Почта','p@company.ru');await click(head.el,'Отправить приглашение');assert.deepEqual(created,['unit-sales']);
 await head.close();
 const employee=await render(ui,{identity:{subject:{tenant_id:'t',user_id:'ivan'},capabilities:[]},projects:[]});
 assert.match(employee.el.textContent,/недоступно/);assert.equal(employee.el.querySelector('[role="form"]'),null);
 await employee.close();
});
test('карточка сотрудника: отдел словами, «Администратор» переключателем с подтверждением, компетенции метками; компетенции — отдельный блок',async()=>{
 const calls=[];const held=new Map();
 const roles=[{id:'role-tz',kind:'functional_role',name:'Проверка ТЗ',active:true},{id:'grp',kind:'group',name:'Архив',active:true}];
 const state=(c,m)=>({container_id:c,container_kind:'',container_name:'',member_id:m,member_kind:'user',member_name:'Иван',container_active:true,member_active:true,enabled:held.get(c+'/'+m)??false,generation:1});
 const ui={listPeople:async()=>({users:[{userName:'ivan',displayName:'Иван',active:true}]}),listOrgUnits:async()=>units,listInvitations:async()=>[],listPersonRights:async()=>({exists:true,rights:[]}),
  listOrganizationRoles:async()=>({roles,next_cursor:'',generation:3}),readPrincipalMembership:async(c,m)=>state(c,m),
  setPrincipalMembership:async(c,m,d)=>{calls.push([c,m,d.enabled]);held.set(c+'/'+m,d.enabled);return state(c,m);},
  createOrganizationRole:async input=>{calls.push(['create',input.kind,input.name,input.expected_generation]);return {id:'new',kind:input.kind,name:input.name,active:true};}};
 const view=await render(ui);await act(async()=>{await new Promise(r=>setTimeout(r,0));});
 await click(view.el,'Открыть карточку: Иван');await act(async()=>{await new Promise(r=>setTimeout(r,0));});
 const card=view.el.querySelector('[aria-label="Сотрудник: Иван"]');
 assert.match(card.textContent,/Продажи/,'отдел словами');
 assert.doesNotMatch(card.textContent,/Архив/,'произвольные группы в карточке не показаны');
 const sw=card.querySelector('[aria-label="Администратор"]');await act(async()=>sw.click());
 assert.match(card.querySelector('[aria-label="Подтверждение администратора"]').textContent,/всех проектов/);assert.deepEqual(calls,[],'без подтверждения ничего не меняется');
 await click(card,'Сделать администратором');
 assert.deepEqual(calls.at(-1),['system:organization-admins','ivan',true]);
 await type(card,'Добавить компетенцию','role-tz');await click(card,'Добавить');await act(async()=>{await new Promise(r=>setTimeout(r,0));});
 assert.deepEqual(calls.at(-1),['role-tz','ivan',true]);
 assert.ok(card.querySelector('[aria-label="Убрать компетенцию: Проверка ТЗ"]'),'метка компетенции');
 const skills=view.el.querySelector('section[aria-label="Компетенции"]');
 await type(skills,'Новая компетенция','Юридическая экспертиза');await click(skills,'Создать');
 assert.deepEqual(calls.at(-1),['create','functional_role','Юридическая экспертиза',3]);
 assert.equal(view.el.textContent.includes('Группы и компетенции'),false,'смешанного экрана групп нет');
 await view.close();
});

after(()=>{dom.window.close();for(const channel of channels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=OriginalMessageChannel;});
