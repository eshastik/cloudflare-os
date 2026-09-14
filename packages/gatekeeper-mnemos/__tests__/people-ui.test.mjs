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
const data={identity:{capabilities:['principal.manage']},projects:[{id:'project',name:'Строительство'}]};
async function render(ui,props=data){const el=document.createElement('div');document.body.append(el);const root=createRoot(el);await act(async()=>{root.render(h(HostProvider,{value:{ui,host:{ui},legacy:document.createElement('div')}},h(PeopleTab,{data:props})));});return {el,async close(){await act(async()=>root.unmount());el.remove();}};}
async function click(el,text){const button=[...el.querySelectorAll('button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text);assert.ok(button,text);await act(async()=>button.click());}
test('Без полномочия управление людьми не запрашивает персональные данные',async()=>{let calls=0;const view=await render({listPeople(){calls++;return Promise.resolve({users:[]});}},{...data,identity:{capabilities:[]}});assert.match(view.el.textContent,/недоступно/);assert.equal(calls,0);await view.close();});
test('Отзыв требует предварительного итога и сохраняет точную предметную область',async()=>{
 const legal={kind:'anchor',principal_id:'person',project_id:'project',node_id:'contracts',class:'filesystem',mode:'read',functional_role_id:'legal'};
 const financial={...legal,node_id:'',functional_role_id:'finance',mode:'write'};
 const calls=[];let reads=0;
 const ui={listPeople:async()=>({users:[{userName:'person',externalId:'sub',displayName:'Иван',active:true}]}),listPersonRights:async()=>{reads++;return {exists:true,rights:reads===1?[legal,financial]:[financial]};},listOrganizationRoles:async()=>({roles:[{id:'legal',name:'Юридическая',active:true,kind:'functional_role'},{id:'finance',name:'Финансовая',active:true,kind:'functional_role'}],next_cursor:''}),removePersonRight:async r=>{calls.push(r);return {outcome:'removed',right:r};}};
 const view=await render(ui);await click(view.el,'Настроить доступ: Иван');assert.match(view.el.textContent,/Юридическая/);assert.match(view.el.textContent,/Финансовая/);
 await click(view.el,'Отозвать назначение');assert.equal(calls.length,0);assert.match(view.el.querySelector('[aria-label="Подтверждение изменения доступа"]').textContent,/Юридическая/);
 await click(view.el,'Подтвердить отзыв');assert.deepEqual(calls,[legal]);assert.match(view.el.textContent,/Финансовая/);assert.equal(view.el.querySelector('[aria-label="Подтверждение изменения доступа"]'),null);await view.close();
});

after(()=>{dom.window.close();for(const channel of channels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=OriginalMessageChannel;});
