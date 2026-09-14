import {useEffect, useRef, useState} from "react";
import {Button} from "@cloudflare/kumo";
import {ArrowLeft, Users} from "@phosphor-icons/react";
import type {OrganizationRolePage, PrincipalMembership} from "../src/mnemos-api.ts";
import type {AdminPerson} from "../src/admin-people.ts";
import {useUi} from "./host.ts";
import {Notice, Select, TextInput} from "./ui.tsx";

export default function RoleMembershipPanel({onClose}:{onClose():void}) {
 const ui=useUi(), epoch=useRef(0);
 const [catalog,setCatalog]=useState<OrganizationRolePage|null>(null),[people,setPeople]=useState<AdminPerson[]>([]);
 const [role,setRole]=useState(""),[member,setMember]=useState(""),[query,setQuery]=useState("");
 const [state,setState]=useState<PrincipalMembership|null>(null),[pending,setPending]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [creating,setCreating]=useState(false),[name,setName]=useState(""),[kind,setKind]=useState<"group"|"functional_role">("group");
 const [newId,setNewId]=useState(()=>crypto.randomUUID());
 async function reload(){
  const request=++epoch.current;setBusy(true);setError("");setState(null);setPending(false);setCatalog(null);setPeople([]);
  try {
   const users=await ui.listPeople();
   const roles:OrganizationRolePage["roles"]=[];let cursor="",generation:number|undefined;const seen=new Set<string>();
   do {if(seen.has(cursor))throw Error();seen.add(cursor);const page=await ui.listOrganizationRoles(cursor);if(generation!==undefined&&generation!==page.generation)throw Error();generation=page.generation;roles.push(...page.roles);cursor=page.next_cursor;}while(cursor);
   if(request!==epoch.current)return;
   setPeople(users.users);setCatalog({roles,next_cursor:"",generation:generation!});
  }catch {if(request===epoch.current)setError("Не удалось обновить список. Проверьте подключение и повторите загрузку.");}
  finally {if(request===epoch.current)setBusy(false);}
 }
 useEffect(()=>{void reload();return()=>{epoch.current++;};},[ui]);
 async function readMembership(container:string,person:string){
  const request=++epoch.current;setState(null);setPending(false);setError("");setNotice("");
  if(!container||!person){setBusy(false);return;}setBusy(true);
  try {const result=await ui.readPrincipalMembership(container,person);if(request===epoch.current)setState(result);}
  catch {if(request===epoch.current)setError("Не удалось проверить членство. Изменение недоступно до повторного чтения.");}
  finally {if(request===epoch.current)setBusy(false);}
 }
 async function change(){
  if(!state||busy||!pending)return;const shown=state,request=++epoch.current;
  setBusy(true);setPending(false);setState(null);setError("");
  try {const result=await ui.setPrincipalMembership(shown.container_id,shown.member_id,{expected_generation:shown.generation,expected_enabled:shown.enabled,enabled:!shown.enabled});if(request===epoch.current){setState(result);setNotice(result.enabled?"Участник добавлен.":"Участник исключён из группы или роли.");}}
  catch {if(request===epoch.current)setError("Изменение не подтверждено. Обновите членство перед повтором: права или состав могли измениться.");}
  finally {if(request===epoch.current)setBusy(false);}
 }
 async function create(){
  if(!catalog||busy||!name.trim())return;const request=++epoch.current;setBusy(true);setError("");
  try {const result=await ui.createOrganizationRole({id:newId,kind,name:name.trim(),expected_generation:catalog.generation});if(request!==epoch.current)return;setRole(result.id);setMember("");setState(null);setCreating(false);setName("");setNewId(crypto.randomUUID());await reload();setNotice("Создано без участников и прав. Теперь можно настроить состав.");}
  catch {if(request===epoch.current){setCatalog(null);setError("Создание не подтверждено. Обновите список перед повтором; уже созданная запись останется в нём.");}}
  finally {if(request===epoch.current)setBusy(false);}
 }
 const selected=catalog?.roles.find(r=>r.id===role);
 const visible=catalog?.roles.filter(r=>r.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))??[];
 return <section aria-label="Группы и роли" className="space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex items-center gap-3"><Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onClose}>Назад</Button><h2 className="m-0 text-lg font-semibold">Группы и роли</h2></div>
   <div className="flex gap-2"><Button variant="ghost" disabled={busy} onClick={()=>void reload()}>Обновить список</Button><Button disabled={busy||!catalog} onClick={()=>setCreating(!creating)}>Создать группу или роль</Button></div>
  </div>
  <p className="m-0 text-sm text-kumo-subtle">Объединяйте сотрудников по отделам и компетенциям. Выберите группу и участника, чтобы проверить и изменить членство.</p>
  {error&&<Notice tone="danger">{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  {creating&&<form className="grid gap-4 rounded-xl border border-kumo-line bg-kumo-elevated p-5 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void create();}}>
   <label className="grid gap-2 text-sm">Название<TextInput required maxLength={255} aria-label="Название группы или роли" placeholder="Например, Юридический отдел" value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
   <label className="grid gap-2 text-sm">Тип<Select value={kind} disabled={busy} onChange={e=>setKind(e.target.value as typeof kind)}><option value="group">Группа</option><option value="functional_role">Функциональная роль</option></Select></label>
   <p className="m-0 text-sm text-kumo-subtle sm:col-span-2">Группа объединяет людей. Функциональная роль обозначает компетенцию. Создание не назначает права и не добавляет участников.</p>
   <div className="flex gap-2"><Button type="submit" disabled={busy||!catalog||!name.trim()}>Создать</Button><Button variant="ghost" disabled={busy} onClick={()=>setCreating(false)}>Отмена</Button></div>
  </form>}
  <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
   <aside className="rounded-xl border border-kumo-line bg-kumo-elevated p-3" aria-label="Список групп и ролей">
    <TextInput type="search" aria-label="Найти группу или роль" placeholder="Поиск по названию" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="mt-3 flex max-h-[55vh] flex-col gap-1 overflow-y-auto">{visible.map(r=><button type="button" key={r.id} aria-pressed={role===r.id} disabled={busy} className={"rounded-lg px-3 py-3 text-left text-sm hover:bg-kumo-tint disabled:opacity-50 "+(role===r.id?"bg-kumo-fill":"")} onClick={()=>{setRole(r.id);setMember("");void readMembership(r.id,"");}}><span className="block font-medium">{r.name||"Без названия"}</span><span className="mt-1 block text-xs text-kumo-subtle">{r.kind==="group"?"Группа":"Функциональная роль"}{!r.active?" · Неактивна":""}</span></button>)}</div>
    {!catalog&&busy&&<Notice>Загружаем список…</Notice>}
    {catalog&&!visible.length&&<Notice>{query?"Ничего не найдено.":"Групп и ролей пока нет. Создайте первую."}</Notice>}
   </aside>
   <div className="min-w-0 rounded-xl border border-kumo-line p-5">{!selected?<div className="py-8 text-center"><Users size={28} className="mx-auto text-kumo-subtle"/><h3 className="text-base font-medium">Выберите группу или роль</h3><p className="text-sm text-kumo-subtle">Здесь можно проверить членство и добавить или исключить участника.</p></div>:<div className="space-y-4">
    <h3 className="m-0 text-base font-semibold">{selected.name||"Без названия"}</h3>
    {selected.id==="system:organization-admins"&&<Notice>Администраторы получают чтение и запись файлов и баз всех существующих и новых проектов организации, во всех предметных областях. Согласование специалистами сохраняется. Добавляйте только сотрудников, которым нужен полный доступ.</Notice>}
    <label className="grid gap-2 text-sm">Участник<Select aria-label="Участник группы или роли" value={member} disabled={busy} onChange={e=>{setMember(e.target.value);void readMembership(role,e.target.value);}}><option value="">Выберите участника</option><optgroup label="Сотрудники">{people.map(p=><option key={p.userName} value={p.userName}>{p.displayName||"Без имени"}{!p.active?" · Неактивен":""}</option>)}</optgroup></Select></label>
    {member&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>void readMembership(role,member)}>Обновить членство</Button>}
    {busy&&member&&<Notice>Проверяем членство…</Notice>}
    {state&&<><Notice>{state.member_name||"Выбранный участник"}{state.enabled?" входит в эту группу или роль.":" не входит в эту группу или роль."}</Notice>
     <p className="text-sm text-kumo-subtle">Членство даёт уже назначенные группе или роли права, в том числе в других проектах. Исключение сохраняет личные разрешения и права из других групп.</p>
     {!pending?<Button disabled={!state.enabled&&(!state.container_active||!state.member_active)} variant="secondary" onClick={()=>setPending(true)}>{state.enabled?"Исключить участника":"Добавить участника"}</Button>:<div className="space-y-3 rounded-lg border border-kumo-line bg-kumo-elevated p-4"><p className="m-0 text-sm">{state.enabled?"Исключить":"Добавить"} «{state.member_name||"Выбранный участник"}» {state.enabled?"из":"в"} «{state.container_name||selected.name}»?</p><div className="flex gap-2"><Button onClick={()=>void change()}>Подтвердить изменение</Button><Button variant="ghost" onClick={()=>setPending(false)}>Отмена</Button></div></div>}
    </>}
   </div>}</div>
  </div>
 </section>;
}
