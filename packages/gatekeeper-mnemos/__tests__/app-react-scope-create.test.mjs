import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountMemoryApp} from './app-react-harness.mjs';

test('permissions hide modules; refreshing exposes authorized project creation and opens the created project',async()=>{
 let capabilities=[],projects=[];
 const app=await mountMemoryApp({
  async whoAmI(){return {subject:{tenant_id:'org',user_id:'alice'},tenant_name:'Team',capabilities}},
  async listProjects(){return {projects}},
  async createProject(name,slug){app.calls.push(['createProject',name,slug]);const project={id:'created',name,slug};projects=[project];return {project}},
 });
 try{
  await app.open('Проекты');await app.until(()=>app.text().includes('Доступных проектов нет.'),'empty projects');
  assert.equal(app.button('Создать проект'),undefined);assert.equal(app.tab('Организация'),undefined);
  capabilities=['project.create','platform.metrics.read'];app.button('Обновить права').click();
  await app.until(()=>app.button('Создать проект'),'permission refreshed');
  app.button('Создать проект').click();await app.until(()=>app.document.querySelector('form[aria-label="Новый проект"]'),'create form');
  const inputs=app.document.querySelectorAll('form[aria-label="Новый проект"] input');app.type(inputs[0],'Новый проект команды');app.type(inputs[1],'new-team');
  await app.until(()=>!app.button('Создать').disabled,'name accepted');app.button('Создать').click();
  await app.until(()=>app.calls.some(c=>c[0]==='createProject')&&app.text().includes('Новый проект команды')&&!app.document.querySelector('form[aria-label="Новый проект"]'),'created project loaded');
  assert.deepEqual(app.calls.find(c=>c[0]==='createProject'),['createProject','Новый проект команды','new-team']);
  await app.open('Организация');await app.until(()=>app.button('Открыть: Метрики платформы'),'metrics visible');
  assert.equal(app.button('Открыть: Журнал операций'),undefined);assert.equal(app.button('Открыть: Состав групп и ролей'),undefined);
 }finally{app.dispose()}
});

test('Workshop project access updates the existing binding with the displayed scope',async()=>{
 let scope=['one'];const app=await mountMemoryApp({
  async listAgentConnections(cursor){if(!cursor)return {connections:[],next_cursor:'next'};return {connections:[{binding_id:'workshop-binding',agent_principal_id:'agent-workshop',runtime_id:'workshop',runtime_agent_id:'same-agent',revoked:false,document_grants:scope.map(project_id=>({project_id,node_id:'',mode:'write',resource_class:'filesystem',granted_to:'agent-workshop'}))}],next_cursor:''}},
  async readWorkshopAgentScope(){return {binding_id:'workshop-binding',project_ids:scope}},
  async updateWorkshopAgentScope(binding,expected,projects){app.calls.push(['updateScope',binding,expected,projects]);scope=projects;return {binding_id:binding,project_ids:projects}},
 });
 try{
  await app.open('Агенты');await app.until(()=>app.button('Загрузить ещё агентов'),'pagination');app.button('Загрузить ещё агентов').click();await app.until(()=>app.button('Изменить проекты агента'),'scope action');app.button('Изменить проекты агента').click();
  const section=()=>app.document.querySelector('section[aria-label="Проекты агента"]');await app.until(()=>section()?.querySelectorAll('input').length===2&&!section().querySelector('input').disabled,'scope loaded');
  const boxes=section().querySelectorAll('input');boxes[1].click();await app.until(()=>boxes[1].checked,'new project selected');boxes[0].click();
  app.button('Сохранить доступ').click();await app.until(()=>app.calls.some(c=>c[0]==='updateScope')&&!section(),'updated');
  assert.deepEqual(app.calls.find(c=>c[0]==='updateScope'),['updateScope','workshop-binding',['one'],['two']]);
 }finally{app.dispose()}
});
