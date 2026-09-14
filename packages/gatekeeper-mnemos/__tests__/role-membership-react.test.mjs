import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";
const role={id:"private-role",name:"Юристы",kind:"group",active:true};
const person={userName:"private-person",displayName:"Анна",active:true};
const state={container_id:role.id,member_id:person.userName,container_name:role.name,member_name:person.displayName,container_active:true,member_active:true,enabled:false,generation:7};
const defaults={async listPeople(){return {users:[person]};},async listOrganizationRoles(){return {roles:[role],next_cursor:"",generation:7};},async readPrincipalMembership(){return {...state};}};
async function open(app){await app.until(()=>app.button("Группы и компетенции"),"вход");app.button("Группы и компетенции").click();await app.until(()=>app.button("ЮристыГруппа"),"каталог");}
test("выбор по именам, подтверждение версии и повторное чтение после потери ответа",async()=>{
 const writes=[];const app=await mountMemoryApp({...defaults,async setPrincipalMembership(...args){writes.push(args);throw Error("lost");}},{section:"people"});
 try {await open(app);assert(!app.text().includes("private-role"));assert(!app.text().includes("ID участника"));assert.equal(app.buttons().filter(b=>b.textContent==="Назад").length,1);app.button("ЮристыГруппа").click();await app.until(()=>app.document.querySelector('[aria-label="Участник группы или роли"]'),"участник");app.type(app.document.querySelector('[aria-label="Участник группы или роли"]'),person.userName);await app.until(()=>app.button("Добавить участника"),"членство");app.button("Добавить участника").click();await app.until(()=>app.button("Подтвердить изменение"),"подтверждение");assert.equal(writes.length,0);app.button("Подтвердить изменение").click();await app.until(()=>app.text().includes("Изменение не подтверждено"),"ошибка");assert.equal(app.button("Добавить участника"),undefined);assert.deepEqual(writes[0],[role.id,person.userName,{expected_generation:7,expected_enabled:false,enabled:true}]);app.button("Обновить членство").click();await app.until(()=>app.button("Добавить участника"),"новое чтение");assert.equal(writes.length,1);}finally{app.dispose();}
});
test("создание группы генерирует ID без выдачи прав",async()=>{
 const calls=[],roles=[role];const app=await mountMemoryApp({...defaults,async listOrganizationRoles(){return {roles,next_cursor:"",generation:7};},async createOrganizationRole(input){calls.push(input);const value={...input,active:true};roles.push(value);return value;}},{section:"people"});
 try {await open(app);app.button("Создать группу или роль").click();await app.until(()=>app.document.querySelector('[aria-label="Название группы или роли"]'),"форма");app.type(app.document.querySelector('[aria-label="Название группы или роли"]'),"Финансы");await app.until(()=>app.button("Создать")?.disabled===false,"ввод");app.button("Создать").click();await app.until(()=>app.text().includes("Создано без участников и прав"),"создано");assert.equal(calls.length,1);assert.match(calls[0].id,/^[a-f0-9-]{36}$/);assert.equal(calls[0].expected_generation,7);assert.equal(calls[0].name,"Финансы");}finally{app.dispose();}
});
test("закрытый экран не показывает запоздалое членство",async()=>{
 let resolve;const app=await mountMemoryApp({...defaults,readPrincipalMembership(){return new Promise(r=>{resolve=r;});}},{section:"people"});
 try {await open(app);app.button("ЮристыГруппа").click();await app.until(()=>app.document.querySelector('[aria-label="Участник группы или роли"]'),"участник");app.type(app.document.querySelector('[aria-label="Участник группы или роли"]'),person.userName);await app.until(()=>resolve,"запрос");app.button("Назад").click();resolve({...state,member_name:"Скрытые данные"});await app.until(()=>app.button("Группы и компетенции"),"назад");assert(!app.text().includes("Скрытые данные"));}finally{app.dispose();}
});
