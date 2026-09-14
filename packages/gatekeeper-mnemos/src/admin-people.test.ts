import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";
import { MnemosAccount, type AccountStorage } from "./account-session.ts";
import { checkedAdminRight, type AdminRight } from "./admin-people.ts";
const right: AdminRight = {kind:"anchor",principal_id:"person",project_id:"project",node_id:"folder",class:"filesystem",mode:"read",functional_role_id:"legal"};
function storage(): AccountStorage { const values=new Map<string,unknown>();return {get:<T>(key:string)=>values.get(key) as T|undefined,put:(key,value)=>{values.set(key,value);},delete:key=>{values.delete(key);}}; }
test("Выдача и отзыв сохраняют область ресурса, узел и все остальные оси", async()=>{
 const calls:{path:string;body:unknown;authorization:string|null}[]=[];
 const api=new MnemosAPI("https://memory.example",async()=>"human-token",async(url,init)=>{calls.push({path:new URL(String(url)).pathname,body:JSON.parse(String(init?.body)),authorization:new Headers(init?.headers).get("Authorization")});return Response.json({right,outcome:"removed"});});
 await api.grantPersonRight(right);await api.removePersonRight(right);
 assert.deepEqual(calls,[{path:"/v1/admin/rights",body:right,authorization:"Bearer human-token"},{path:"/v1/admin/rights/remove",body:right,authorization:"Bearer human-token"}]);
 assert.equal(checkedAdminRight({...right,class:"database",mode:"write"}).functional_role_id,"legal");
 assert.throws(()=>checkedAdminRight({...right,project_id:""}));
});
test("Сессия проверяет свежие полномочия и не отправляет административный запрос после отзыва",async()=>{
 let allowed=true, writes=0;
 const account=new MnemosAccount(storage(),"https://memory.example",async(url)=>{
 if(String(url).endsWith("/whoami"))return Response.json({subject:{tenant_id:"org",user_id:"admin"},capabilities:allowed?["principal.manage"]:[]});
 writes++;return Response.json({right});
 });
 await account.connect("human-token");const session=account.session();await session.grantPersonRight(right);allowed=false;
 await assert.rejects(session.removePersonRight(right),e=>e instanceof MnemosAPIError&&e.status===403);
 await assert.rejects(session.listPeople());assert.equal(writes,1);session.dispose();
});
test("Отказ сервера не превращается в успешное изменение",async()=>{
 const api=new MnemosAPI("https://memory.example",async()=>"human-token",async()=>new Response("internal secret",{status:403}));
 await assert.rejects(api.createPerson({issuer:"https://id.example",user:{userName:"person",externalId:"subject",displayName:"Иван"}}),e=>e instanceof MnemosAPIError&&e.status===403&&!e.message.includes("secret"));
 await assert.rejects(api.grantPersonRight(right));
});

import { managementSections } from "./management-sections.ts";
test("Административные разделы появляются только по соответствующим полномочиям",()=>{
 const identity={subject:{tenant_id:"org",user_id:"person"},tenant_name:"Компания"};
 assert.ok(managementSections(identity).every(s=>s.group==="work"));
 assert.deepEqual(managementSections({...identity,capabilities:["project.create"]}).filter(s=>s.group==="manage").map(s=>s.id),["intake"]);
 assert.deepEqual(managementSections({...identity,capabilities:["principal.manage"]}).filter(s=>s.group==="manage").map(s=>s.id),["people","organization"]);
});

test("Приёмная использует полномочие создания проекта, а не управления людьми",async()=>{
 let capabilities=["principal.manage"], tickets=0;
 const account=new MnemosAccount(storage(),"https://memory.example",async(url,init)=>{
   if(String(url).endsWith("/whoami")) return Response.json({subject:{tenant_id:"org",user_id:"person"},capabilities});
   assert.equal(new URL(String(url)).pathname,"/v1/inbox/uploads");
   assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer human-token");
   tickets++;return Response.json({upload_id:"ticket"});
 });
 await account.connect("human-token");const session=account.session();
 await assert.rejects(session.beginInboxUpload(5,"a".repeat(43)+"="));assert.equal(tickets,0);
 capabilities=["project.create"];await session.beginInboxUpload(5,"a".repeat(43)+"=");assert.equal(tickets,1);session.dispose();
});

test("Решение приёмной использует реальный маршрут без дополнительного суффикса",async()=>{
 const calls:string[]=[];
 const api=new MnemosAPI("https://memory.example",async()=>"human-token",async(url,init)=>{calls.push(new URL(String(url)).pathname);assert.equal(init?.method,"POST");assert.deepEqual(JSON.parse(String(init?.body)),{approve:true,place:"project/legal/file.txt"});return Response.json({alert:{}});});
 await api.decideInboxAlert("question",{approve:true,place:"project/legal/file.txt"});
 assert.deepEqual(calls,["/v1/inbox/alerts/question"]);
});
