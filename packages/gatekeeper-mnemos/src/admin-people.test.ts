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
test("Перечень разделов по ревизии 24.09: три для всех, пять администратору, старых разделов нет",()=>{
 const identity={subject:{tenant_id:"org",user_id:"person"},tenant_name:"Компания"};
 assert.deepEqual(managementSections(identity).map(s=>[s.id,s.title,s.group]),[["my-work","Входящие","work"],["projects","Проекты","work"],["documents","Материалы","work"]]);
 assert.deepEqual(managementSections({...identity,capabilities:["project.create"]}).filter(s=>s.group==="manage").map(s=>s.id),[]);
 assert.deepEqual(managementSections({...identity,capabilities:["principal.manage"]}).filter(s=>s.group==="manage").map(s=>[s.id,s.title]),
  [["people","Люди и отделы"],["rules","Правила"],["connections","Подключения"],["agents","Агенты и расходы"],["journal","Журнал и состояние"]]);
 assert.deepEqual(managementSections({...identity,capabilities:["platform.metrics.read"]}).filter(s=>s.group==="manage").map(s=>s.id),["journal"]);
 const all=managementSections({...identity,capabilities:["principal.manage","project.create","platform.metrics.read"]}).map(s=>s.id);
 for(const gone of ["approvals","sources","templates","analytics","intake","organization"])assert.ok(!all.includes(gone),gone);
});

test("Приглашение: роль «Сотрудник» не передаётся, «Руководитель отдела» требует отдела; удаление отдела возвращает итог",async()=>{
 const bodies:unknown[]=[];const invitation={invitation_id:"inv",email:"a@b.ru",display_name:"",created_by:"o",created_by_name:"",created_at:"",expires_at:"",status:"open",code:"c".repeat(43)};
 const api=new MnemosAPI("https://memory.example",async()=>"t",async(url,init)=>{
  if(init?.method==="DELETE")return Response.json({deleted:true,projects_made_private:2,requests_closed:1,invitations_revoked:0,members_removed:4});
  bodies.push(JSON.parse(String(init?.body)));return Response.json(invitation);});
 await api.createInvitation("a@b.ru","","unit");await api.createInvitation("a@b.ru","","unit","head");await api.createInvitation("a@b.ru","","","admin");
 assert.deepEqual(bodies,[{email:"a@b.ru",display_name:"",org_unit_id:"unit"},{email:"a@b.ru",display_name:"",org_unit_id:"unit",role:"head"},{email:"a@b.ru",display_name:"",org_unit_id:"",role:"admin"}]);
 await assert.rejects(api.createInvitation("a@b.ru","","","head"),e=>e instanceof MnemosAPIError&&e.status===400);
 await assert.rejects(api.createInvitation("a@b.ru","","unit","owner" as never),e=>e instanceof MnemosAPIError&&e.status===400);
 assert.deepEqual(await api.deleteOrgUnit("unit"),{deleted:true,projects_made_private:2,requests_closed:1,invitations_revoked:0,members_removed:4});
 const broken=new MnemosAPI("https://memory.example",async()=>"t",async()=>Response.json({deleted:true}));
 await assert.rejects(broken.deleteOrgUnit("unit"),e=>e instanceof MnemosAPIError&&e.status===502);
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

test("Проектная загрузка идёт сразу в проект, вопросы и решение сохраняют проект", async()=>{
 const calls:Array<{url:string;body:unknown}>=[];
 const api=new MnemosAPI("https://memory.example",async()=>"human-token",async(url,init)=>{
  calls.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):undefined});
  return Response.json({alerts:[],truncated:false});
 });
 await api.submitProjectUpload("project-a","upload","договор.txt");
 await api.inboxAlerts(false,undefined,"project-a");
 await api.decideInboxAlert("question",{approve:true,place:"project/legal/договор.txt",intake_project_id:"project-a"});
 // Выбранный человеком проект кладётся сразу (решение владельца 23.09): флаг проверки не шлётся.
 assert.equal((calls[0].body as {review_required?:boolean}).review_required,undefined);
 assert.equal((calls[0].body as {project_id:string}).project_id,"project-a");
 assert.equal(new URL(calls[1].url).searchParams.get("project_id"),"project-a");
 assert.equal((calls[2].body as {intake_project_id:string}).intake_project_id,"project-a");
});

test("Статус проекта запрашивается без админского полномочия, общая очередь остаётся закрыта",async()=>{
 const requests:string[]=[];
 const account=new MnemosAccount(storage(),"https://memory.example",async(url)=>{
  if(String(url).endsWith("/whoami"))return Response.json({subject:{tenant_id:"org",user_id:"member"},capabilities:[]});
  requests.push(String(url));return Response.json({total:1,in_queue:1});
 });
 await account.connect("human-token");const session=account.session();
 try {
  const status=await session.inboxStatus("проект & 1");assert.equal(status.in_queue,1);
  assert.equal(new URL(requests[0]).pathname,"/v1/inbox/status");
  assert.equal(new URL(requests[0]).searchParams.get("project_id"),"проект & 1");
  await assert.rejects(session.inboxStatus());assert.equal(requests.length,1);
 }finally{session.dispose();}
});
