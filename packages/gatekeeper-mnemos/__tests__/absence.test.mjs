import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import {JSDOM} from 'jsdom';
import {RpcTarget,newMessagePortRpcSession} from 'capnweb';

test('absence consent: lost save requires reread; disable uses saved terms despite edited form',async()=>{
 let saved={project_id:'project',local_binding_id:'local',managed_binding_id:'managed',starts_at:'2026-09-10T00:00:00Z',ends_at:'2026-09-12T00:00:00Z',revision:1,enabled:true};
 const writes=[]; let lost=true;
 class UI extends RpcTarget {
  async whoAmI(){return {subject:{tenant_id:'org',user_id:'human'}}}
  async listProjects(){return {projects:[{id:'project',name:'Project',slug:'project'}]}}
  async managedAgentRequest(){return null}
  async managedTaskRequest(){return null}
  async recordUIReadiness(){}
  async listAgentConnections(){return {connections:[{binding_id:'local',agent_principal_id:'Local',runtime_id:'external',managed_runtime:false,revoked:false},{binding_id:'managed',agent_principal_id:'Managed',runtime_id:'runtime',managed_runtime:true,revoked:false}]}}
  async browseProject(){return {nodes:[],truncated:false}}
  async readAgentAbsence(project){assert.equal(project,'project');return saved}
  async setAgentAbsence(project,input){assert.equal(project,'project');writes.push(structuredClone(input));saved={...input,project_id:project,revision:input.expected_revision+1};if(lost){lost=false;throw new Error('lost')}return saved}
 }
 class Host extends RpcTarget {#ui=new UI();get ui(){return this.#ui}async subscribeTheme(){return 'dark'}}
 const ports=[];let peer;
 const dom=new JSDOM(await readFile(new URL('../src/generated/app.txt',import.meta.url),'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(window){
  for(const key of ['ReadableStream','WritableStream','TransformStream','TextEncoder','TextDecoder','Request','Response','Headers'])window[key]=globalThis[key];
  // Оболочке на React (Kumo) нужны наблюдатель размера и медиазапросы; в jsdom их нет.
  window.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  window.matchMedia=()=>({matches:false,media:'',addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  window.MessageChannel=class extends MessageChannel{constructor(){super();ports.push(this.port1,this.port2)}};
  window.postMessage=(_m,_o,transferred)=>{peer=newMessagePortRpcSession(transferred[0],new Host())};
 }});
 // Прежние разделы живут в контейнере #legacy под вкладкой «Ещё»; кнопки ищутся только там.
 const button=text=>[...dom.window.document.querySelectorAll('#legacy button')].find(b=>b.textContent===text);
 const until=async(predicate)=>{const end=Date.now()+2000;while(!predicate()){if(Date.now()>end)throw new Error('UI state timeout: '+dom.window.document.body.textContent.slice(0,300));await new Promise(r=>setTimeout(r,5))}};
 try{
  await until(()=>button('Project')&&!button('Project').disabled);button('Project').click();
  await until(()=>button('Замещение на время отсутствия')&&!button('Замещение на время отсутствия').disabled);button('Замещение на время отсутствия').click();
  await until(()=>button('Разрешить замещение')&&!button('Разрешить замещение').disabled);
  assert.equal(writes.length,0);
  button('Разрешить замещение').click();
  await until(()=>dom.window.document.body.textContent.includes('Сохранение не подтверждено'));
  assert.equal(writes.length,1);assert(!button('Разрешить замещение'));assert(!button('Отключить замещение'));
  button('Перечитать настройку').click();await until(()=>button('Отключить замещение')&&!button('Отключить замещение').disabled);
  const input=dom.window.document.querySelector('[aria-label="Начало отсутствия"]');input.value='';input.dispatchEvent(new dom.window.Event('input'));
  button('Отключить замещение').click();await until(()=>writes.length===2&&button('Разрешить замещение')&&!button('Разрешить замещение').disabled);
  assert.equal(writes[1].expected_revision,2);assert.equal(writes[1].starts_at,writes[0].starts_at);assert.equal(writes[1].enabled,false);assert(!button('Отключить замещение'));
 }finally{peer?.[Symbol.dispose]();for(const port of ports)port.close();dom.window.close()}
});
