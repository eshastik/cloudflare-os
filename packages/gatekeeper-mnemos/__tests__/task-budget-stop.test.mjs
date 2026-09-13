import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {MessageChannel} from "node:worker_threads";
import {JSDOM} from "jsdom";
import {RpcTarget,newMessagePortRpcSession} from "capnweb";

test("confirmed budget stop cannot be submitted again and can be archived through the host",async()=>{
 let request={request_id:"stopped",binding_id:"agent",message:"Work",criteria:"Checked result",submitted:true,team_budget:{project_id:"project",proposal_id:"proposal",role:"worker"}};
 let archives=0,submissions=0,failArchive=true;
 class UI extends RpcTarget{
  async whoAmI(){return {subject:{tenant_id:"org",user_id:"owner"},tenant_name:"Team"};}
  async listProjects(){return {projects:[]};}
  async managedAgentRequest(){return null;}
  async managedTaskRequest(){return request;}
  async listAgentConnections(){return {connections:[]};}
  async recordUIReadiness(){}
  async refreshSavedAgentTask(id){assert.equal(id,"stopped");return {...request,outcome:{request_id:id,state:"budget_blocked"}};}
  async submitSavedAgentTask(){submissions++;throw Error("Stopped request must never be submitted");}
  async cancelSavedTeamTask(id){assert.equal(id,"stopped");archives++;if(failArchive)throw Error("Unconfirmed archive");request=null;}
 }
 class Host extends RpcTarget{#ui=new UI();get ui(){return this.#ui;}async subscribeTheme(){return "light";}}
 const ports=[];let peer;
 const dom=new JSDOM(await readFile(new URL("../src/generated/app.txt",import.meta.url),"utf8"),{
  runScripts:"dangerously",pretendToBeVisual:true,beforeParse(window){
   for(const key of ["ReadableStream","WritableStream","TransformStream","TextEncoder","TextDecoder","Request","Response","Headers"])window[key]=globalThis[key];
   window.MessageChannel=class extends MessageChannel{constructor(){super();ports.push(this.port1,this.port2);}};
   window.postMessage=(message,origin,transferred)=>{assert.equal(message.type,"handshake");peer=newMessagePortRpcSession(transferred[0],new Host());};
  }
 });
 const button=text=>[...dom.window.document.querySelectorAll("button")].find(b=>b.textContent===text);
 const until=async predicate=>{const end=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<end,"UI did not reach expected state");await new Promise(r=>setTimeout(r,5));}};
 try{
  await until(()=>button("Проверить состояние задачи")&&!button("Проверить состояние задачи").disabled);
  button("Проверить состояние задачи").click();
  const archive="Перенести остановленную задачу в историю";
  await until(()=>button(archive)&&!button(archive).disabled);
  assert.match(dom.window.document.body.textContent,/Запуск остановлен лимитом/);
  assert.equal(button("Повторить ту же заявку"),undefined);
  assert.equal(button("Запустить задачу"),undefined);
  button(archive).click();
  await until(()=>archives===1&&button("Проверить состояние задачи")&&!button("Проверить состояние задачи").disabled);
  assert.equal(button("Сохранить задачу"),undefined,"failed archive must preserve current request");
  button("Проверить состояние задачи").click();
  await until(()=>button(archive)&&!button(archive).disabled);
  failArchive=false;button(archive).click();
  await until(()=>button("Сохранить задачу")&&!button("Сохранить задачу").disabled);
  assert.equal(archives,2);assert.equal(submissions,0);
 }finally{dom.window.dispatchEvent(new dom.window.Event("pagehide"));peer?.[Symbol.dispose]();dom.window.close();for(const p of ports)p.close();}
});
