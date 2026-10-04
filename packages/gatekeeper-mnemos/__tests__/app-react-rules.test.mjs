import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Правила»: правила организации на одной странице, сегментами и переключателем; изменение сохраняется сразу", async () => {
  const saved = [];
  const app = await mountMemoryApp({ async updateProjectSharingSettings(settings) { saved.push(settings); } }, { section: "rules" });
  try {
    const group = label => app.document.querySelector(`[role="radiogroup"][aria-label="${label}"]`);
    await app.until(() => group("Кто создаёт проекты"), "правила");
    assert.equal(app.document.querySelector('[aria-label="Правила проектов"] select'), null, "раскрывающихся списков нет");
    assert.ok(app.document.querySelector('[role="switch"]'), "личные проекты — переключателем");
    assert.ok(app.text().includes("Согласования"), "про согласования сказано, где они задаются");
    [...group("Кто создаёт проекты").querySelectorAll('[role="radio"]')].find(b => b.textContent === "Руководители").click();
    await app.until(() => app.text().includes("Сохранено."), "сохранено");
    assert.equal(saved[0].project_create_by, "heads");
    assert.equal([...group("Кто создаёт проекты").querySelectorAll('[aria-checked="true"]')].map(b => b.textContent).join(), "Руководители");
  } finally { app.dispose(); }
});

test("«Правила»: отказ сервера возвращает выбор к сохранённому", async () => {
  const app = await mountMemoryApp({ async updateProjectSharingSettings() { throw new Error("403"); } }, { section: "rules" });
  try {
    const group = () => app.document.querySelector('[role="radiogroup"][aria-label="Кто видит новый проект"]');
    await app.until(() => group(), "правила");
    [...group().querySelectorAll('[role="radio"]')].find(b => b.textContent === "Всем").click();
    await app.until(() => app.text().includes("Не сохранилось."), "отказ показан");
    assert.equal(group().querySelector('[aria-checked="true"]').textContent, "Создателю");
  } finally { app.dispose(); }
});

test("Требования шаблонов сохраняют ревизию и требуют чтения после потерянного ответа", async () => {
  const scopes=new Map([['org',{scope_id:'org',revision:1,name:'Организация',level:'organization',parent_id:'',reader_group_id:'',enabled:true,approvers:['publisher'],review_requirements:[{domain_id:'finance',approvers:['alice']}]}],['dep',{scope_id:'dep',revision:1,name:'Отдел',level:'department',parent_id:'org',reader_group_id:'members',enabled:true,approvers:['publisher'],review_requirements:[]}]]);
  const writes=[]; let lose=false;
  const app=await mountMemoryApp({
    async listManagedTemplateScopes(){return {scopes:[...scopes.values()].map(s=>structuredClone(s))};},
    async listPeople(){return {users:[{userName:'alice',displayName:'Алиса',active:true}]};},
    async setTemplateScope(id,revision,config){const old=scopes.get(id);assert.equal(revision,old.revision);writes.push({id,revision,config});const out={...config,scope_id:id,revision:revision+1};scopes.set(id,structuredClone(out));if(lose)throw Error('Ответ потерян');return out;}
  },{section:'rules'});
  const select=()=>app.document.querySelector('[aria-label="Область правил шаблонов"]');
  try {
    await app.until(()=>select(),'каталог областей');app.type(select(),'org');
    await app.until(()=>app.button('Изменить требования')&&!app.button('Изменить требования').disabled,'редактор доступен');
    app.button('Изменить требования').click();await app.until(()=>app.document.querySelector('[aria-label="Направление шаблонов 1"]'),'форма требований');
    app.type(app.document.querySelector('[aria-label="Направление шаблонов 1"]'),'legal');
    await app.until(()=>!app.button('Сохранить требования').disabled,'требования допустимы');app.button('Сохранить требования').click();
    await app.until(()=>app.text().includes('Требования сохранены'),'запись подтверждена');
    app.type(select(),'dep');await app.until(()=>app.text().includes('Отдельные предметные согласования не назначены'),'другая область');app.type(select(),'org');
    await app.until(()=>[...app.document.querySelectorAll('legend')].some(e=>e.textContent==='legal'),'подтверждённая версия после возврата');
    app.button('Изменить требования').click();await app.until(()=>app.button('Сохранить требования'),'повторная правка');lose=true;
    app.button('Сохранить требования').click();await app.until(()=>app.text().includes('Изменение не подтверждено'),'потерянный ответ');
    assert.equal(writes[1].revision,2);app.button('Отменить правку').click();
    await app.until(()=>!app.button('Отменить правку'),'отмена');assert.equal(select().disabled,true);assert.equal(app.button('Изменить требования').disabled,true);
    app.button('Загрузить текущие правила вместо введённых').click();await app.until(()=>!select().disabled,'прочитана текущая версия');
    lose=false;app.button('Изменить требования').click();await app.until(()=>app.button('Убрать направление'),'правка после чтения');app.button('Убрать направление').click();
    await app.until(()=>!app.button('Сохранить требования').disabled,'пустые требования допустимы');app.button('Сохранить требования').click();
    await app.until(()=>writes.length===3&&!app.button('Сохранить требования'),'требования сняты');
    assert.equal(writes[2].revision,3);assert.deepEqual(writes[2].config.review_requirements,[]);assert.deepEqual(writes[2].config.approvers,['publisher']);assert.equal(writes[2].config.level,'organization');
  } finally {app.dispose();}
});
