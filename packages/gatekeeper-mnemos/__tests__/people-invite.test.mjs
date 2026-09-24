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
async function render(ui,props=admin){const el=document.createElement('div');document.body.append(el);const root=createRoot(el);await act(async()=>{root.render(h(HostProvider,{value:{ui,host:{ui},legacy:document.createElement('div')}},h(PeopleTab,{data:props})));});await act(async()=>{await new Promise(r=>setTimeout(r,0));});return {el,async close(){await act(async()=>root.unmount());el.remove();}};}
const find=(el,text)=>[...el.querySelectorAll('button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text);
async function click(el,text){const button=find(el,text);assert.ok(button,text);await act(async()=>button.click());await act(async()=>{await new Promise(r=>setTimeout(r,0));});}
async function type(el,label,value){const input=[...el.querySelectorAll('label')].find(l=>l.textContent.startsWith(label))?.querySelector('input,select')??el.querySelector(`[aria-label="${label}"]`);assert.ok(input,label);await act(async()=>{const proto=input.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
const units=[{org_unit_id:'unit-sales',name:'Продажи',members:[{principal_id:'head',display_name:'Ольга',is_head:true},{principal_id:'ivan',display_name:'Иван',is_head:false}]}];

test('администратор получает ссылку-приглашение в отдел; идентификаторы видны только под «Подробнее»',async()=>{
 const created=[];let invitations=[];
 const ui={listPeople:async()=>({users:[]}),listOrgUnits:async()=>units,listInvitations:async()=>invitations,
  createInvitation:async(email,name,unit)=>{created.push([email,name,unit]);const invitation={invitation_id:'inv-1',email,display_name:name,org_unit_id:unit,org_unit_name:'Продажи',created_by:'owner',created_by_name:'Анна',created_at:'2026-09-24T10:00:00Z',expires_at:'2026-10-01T10:00:00Z',status:'open'};invitations=[invitation];return {invitation,link:'https://os.example/gatekeeper/mnemos/oauth/invite/'+'c'.repeat(43)};},
  revokeInvitation:async id=>{invitations=invitations.map(i=>i.invitation_id===id?{...i,status:'revoked'}:i);return invitations[0];}};
 const view=await render(ui);
 await click(view.el,'Пригласить');
 await type(view.el,'Почта','new@company.ru');await type(view.el,'Имя','Пётр');await type(view.el,'Отдел приглашения','unit-sales');
 await click(view.el,'Получить ссылку');
 assert.deepEqual(created,[['new@company.ru','Пётр','unit-sales']]);
 assert.equal(view.el.querySelector('input[aria-label="Ссылка-приглашение"]').value,'https://os.example/gatekeeper/mnemos/oauth/invite/'+'c'.repeat(43));
 assert.match(view.el.textContent,/Ждёт входа/);assert.match(view.el.textContent,/отдел «Продажи»/);
 const details=view.el.querySelector('[data-admin-details]');assert.ok(details,'служебное свёрнуто под «Подробнее»');
 const visible=view.el.textContent.replace(details.textContent,'');assert.doesNotMatch(visible,/inv-1/);
 await click(view.el,'Отозвать приглашение: Пётр');assert.match(view.el.textContent,/Отозвано/);
 await view.close();
});

test('администратор ведёт отделы: создать, добавить сотрудника, назначить руководителя, убрать',async()=>{
 const calls=[];let list=structuredClone(units);
 const ui={listPeople:async()=>({users:[{userName:'ivan',displayName:'Иван',active:true},{userName:'maria',displayName:'Мария',active:true}]}),listOrgUnits:async()=>list,
  createOrgUnit:async name=>{calls.push(['create',name]);const unit={org_unit_id:'unit-new',name,members:[]};list=[...list,unit];return unit;},
  setOrgUnitMember:async(unit,who,member,head)=>{calls.push([unit,who,member,head]);}};
 const view=await render(ui);
 await click(view.el,'Отделы');
 assert.match(view.el.textContent,/Продажи/);assert.match(view.el.textContent,/Руководитель/);assert.doesNotMatch(view.el.textContent.replace([...view.el.querySelectorAll('[data-admin-details]')].map(d=>d.textContent).join(''),''),/unit-sales/);
 await type(view.el,'Новый отдел','Склад');await click(view.el,'Создать отдел');
 await type(view.el,'Добавить в отдел Продажи','maria');await click(view.el,'Добавить в отдел');
 await click(view.el,'Сделать руководителем');
 await click(view.el,'Убрать из отдела: Иван');
 assert.deepEqual(calls,[['create','Склад'],['unit-sales','maria',true,false],['unit-sales','ivan',true,true],['unit-sales','ivan',false,false]]);
 await view.close();
});

test('руководитель отдела без полномочия приглашает только в свой отдел; остальным раздел закрыт',async()=>{
 const created=[];
 const ui={listOrgUnits:async()=>units,listInvitations:async()=>[],createInvitation:async(email,name,unit)=>{created.push(unit);return {invitation:{invitation_id:'inv',email,display_name:name,created_by:'head',created_by_name:'Ольга',created_at:'',expires_at:'',status:'open'},link:'https://os.example/x'};}};
 const head=await render(ui,{identity:{subject:{tenant_id:'t',user_id:'head'},capabilities:[]},projects:[]});
 assert.match(head.el.textContent,/Отдел «Продажи»/);
 const select=head.el.querySelector('[aria-label="Отдел приглашения"]');assert.deepEqual([...select.options].map(o=>o.value),['unit-sales'],'без «Без отдела» и чужих отделов');
 await type(head.el,'Почта','p@company.ru');await click(head.el,'Получить ссылку');assert.deepEqual(created,['unit-sales']);
 await head.close();
 const employee=await render(ui,{identity:{subject:{tenant_id:'t',user_id:'ivan'},capabilities:[]},projects:[]});
 assert.match(employee.el.textContent,/недоступно/);assert.equal(employee.el.querySelector('form'),null);
 await employee.close();
});
after(()=>{dom.window.close();for(const channel of channels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=OriginalMessageChannel;});
