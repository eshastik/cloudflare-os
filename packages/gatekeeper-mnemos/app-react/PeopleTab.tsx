import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { ArrowLeft, Plus, Trash, Users } from "@phosphor-icons/react";
import type { MemoryData } from "./data.ts";
import type { AdminPerson, AdminRight, AdminRights } from "../src/admin-people.ts";
import type { OrganizationRole } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { Notice, Select, StatusBadge, TextInput } from "./ui.tsx";
import { LegacySwitch, useLegacySection } from "./legacy.tsx";

export default function PeopleTab({ data }: { data: MemoryData }) {
  if (!data.identity?.capabilities?.includes("principal.manage")) return <Notice>Управление людьми недоступно для вашей учётной записи.</Notice>;
  return <PeopleManager data={data} />;
}
function PeopleManager({ data }: { data: MemoryData }) {
  const ui = useUi();
  const legacy = useLegacySection();
  const [people, setPeople] = useState<AdminPerson[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => { let current = true; setLoading(true); setError("");
    void ui.listPeople().then(p => { if (current) setPeople(p.users); }, () => { if (current) {setPeople([]);setSelected("");setError("Не удалось получить людей. Проверьте подключение и полномочия.");} }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [ui, revision]);
  const person = people.find(p => p.userName === selected);
  const visiblePeople = people.filter(p => `${p.displayName} ${p.userName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <LegacySwitch state={legacy}><section aria-label="Люди и доступ">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 text-sm text-kumo-subtle">Сотрудников: {people.length}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => legacy.open({kind:"roleMembership"}, "Группы и компетенции")}>Группы и компетенции</Button>
        <Button size="sm" variant={adding?"ghost":"primary"} onClick={() => setAdding(!adding)}>{adding?<ArrowLeft size={16}/>:<Plus size={16}/>}{adding?"К сотрудникам":"Добавить человека"}</Button>
      </div>
    </div>
    {adding && <div className="mb-5 rounded-xl border border-kumo-line bg-kumo-elevated p-5"><CreatePerson onCreated={userName => {setAdding(false); setSelected(userName); setRevision(v => v+1);}} /></div>}
    {error && <Notice tone="danger">{error}</Notice>}
    {!adding&&<div className="grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside aria-label="Сотрудники" className={`${person ? "hidden md:block" : ""} min-w-0`}>
        <TextInput className="w-full" type="search" aria-label="Найти сотрудника" placeholder="Найти сотрудника…" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="mt-3 flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {loading ? <Notice>Загрузка людей…</Notice> : visiblePeople.map(p => <button key={p.userName} type="button" aria-label={`Настроить доступ: ${p.displayName || p.userName}`} aria-pressed={selected === p.userName} onClick={() => setSelected(p.userName)} className={`rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumo-ring ${selected === p.userName ? "bg-kumo-fill text-kumo-strong" : "hover:bg-kumo-tint"}`}>
            <span className="block break-words text-sm font-medium">{p.displayName || p.userName}</span>
            {!p.active&&<span className="mt-1 block text-xs text-kumo-subtle">Доступ приостановлен</span>}
          </button>)}
        </div>
        {!loading && !error && !people.length && <Notice>Добавьте первого сотрудника.</Notice>}
        {!loading && people.length > 0 && !visiblePeople.length && <Notice>По этому запросу никого не найдено.</Notice>}
        {error&&<Button className="mt-3" size="sm" variant="ghost" disabled={loading} onClick={() => setRevision(v => v+1)}>Повторить</Button>}
      </aside>
      <div className="min-w-0">{person ? <><div className="mb-3 md:hidden"><Button size="sm" variant="ghost" onClick={()=>setSelected("")}><ArrowLeft size={16}/>Сотрудники</Button></div><PersonRights key={person.userName} person={person} data={data} /></> : <div className="rounded-xl border border-dashed border-kumo-line px-6 py-12 text-center"><Users size={28} className="mx-auto text-kumo-subtle"/><h2 className="text-base font-medium">Выберите сотрудника</h2><p className="mx-auto max-w-sm text-sm text-kumo-subtle">Посмотрите проекты и настройте доступ.</p></div>}</div>
    </div>}
  </section></LegacySwitch>;
}
function CreatePerson({onCreated}: {onCreated(userName: string): void}) {
  const ui = useUi(); const [name,setName]=useState(""); const [id,setId]=useState<string>(() => crypto.randomUUID()); const [issuer,setIssuer]=useState(""); const [subject,setSubject]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  return <form className="grid gap-3 my-4" onSubmit={e => { e.preventDefault();setBusy(true);setError("");void ui.createPerson({issuer:issuer.trim(),user:{userName:id.trim(),externalId:subject.trim(),displayName:name.trim()}}).then(()=>onCreated(id.trim()),()=>setError("Не удалось добавить человека. Проверьте идентификаторы провайдера и полномочия.")).finally(()=>setBusy(false)); }}>
    <h2 className="m-0 text-base font-semibold">Новый сотрудник</h2>
    <p className="m-0 text-sm text-kumo-subtle">Подключите существующую учётную запись корпоративного входа.</p>
    <div className="grid max-w-lg gap-4">
      <label className="grid gap-1.5 text-sm">Имя<TextInput required value={name} onChange={e=>setName(e.target.value)} /></label>
      <label className="grid gap-1.5 text-sm">Сервер входа<TextInput type="url" required placeholder="https://login.example.ru" value={issuer} onChange={e=>setIssuer(e.target.value)} /></label>
      <label className="grid gap-1.5 text-sm">Идентификатор учётной записи<TextInput required value={subject} onChange={e=>setSubject(e.target.value)} /></label>
      <details className="text-sm text-kumo-subtle"><summary>Дополнительные параметры</summary><label className="mt-3 grid gap-1.5">Идентификатор в Mnemos<TextInput required value={id} onChange={e=>setId(e.target.value)} /></label></details>
    </div>
    {error && <Notice tone="danger">{error}</Notice>}<div><Button variant="primary" type="submit" disabled={busy}>{busy?"Добавляем…":"Добавить человека"}</Button></div>
  </form>;
}
const STANDARD_RESOURCE_DOMAINS=[
 {id:"юридический",name:"Юридические вопросы"},{id:"финансовый",name:"Финансовые вопросы"},
 {id:"коммерческий",name:"Коммерческие вопросы"},{id:"технический",name:"Технические вопросы"},
 {id:"административный",name:"Административные вопросы"},{id:"общий",name:"Общие материалы"},
];
function PersonRights({person,data}: {person:AdminPerson;data:MemoryData}) {
  const ui=useUi(); const [rights,setRights]=useState<AdminRights|null>(null); const [roles,setRoles]=useState<OrganizationRole[]>([]); const [rolesError,setRolesError]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false); const [revision,setRevision]=useState(0);
  const [domains,setDomains]=useState(STANDARD_RESOURCE_DOMAINS),[domainsLoading,setDomainsLoading]=useState(false),[domainsError,setDomainsError]=useState(false);
  const [editing,setEditing]=useState(false);
  const [project,setProject]=useState(""); const [area,setArea]=useState(""); const [scope,setScope]=useState("area"); const [node,setNode]=useState(""); const [resourceClass,setResourceClass]=useState<"filesystem"|"database">("filesystem"); const [mode,setMode]=useState<"read"|"write">("read"); const [pending,setPending]=useState<{right:AdminRight;remove:boolean}|null>(null);
  useEffect(()=>{let current=true;setRights(null);void ui.listPersonRights(person.userName).then(r=>{if(current)setRights(r);},()=>{if(current)setError("Не удалось прочитать текущие назначения. Изменения недоступны.");});return()=>{current=false;};},[ui,person.userName,revision]);
  useEffect(()=>{let current=true;void (async()=>{const all:OrganizationRole[]=[];let cursor="";do {const page=await ui.listOrganizationRoles(cursor);all.push(...page.roles);cursor=page.next_cursor;}while(cursor);if(current)setRoles(all.filter(r=>r.active&&r.kind==="functional_role"));})().catch(()=>{if(current)setRolesError(true);});return()=>{current=false;};},[ui]);
  useEffect(()=>{
    let current=true;setDomains(STANDARD_RESOURCE_DOMAINS);setDomainsError(false);setArea("");
    if(!project){setDomainsLoading(false);return;}
    setDomainsLoading(true);
    void (async()=>{
      const found=new Map(STANDARD_RESOURCE_DOMAINS.map(domain=>[domain.id,domain]));
      const visited=new Set<string>();let cursor="";
      do {
        if(visited.has(cursor)||visited.size>=200)throw Error("Каталог областей неполон");
        visited.add(cursor);
        const page=await ui.browseProject(project,cursor);
        for(const entry of page.nodes)if(entry.functional_role_id){const id=entry.functional_role_id;found.set(id,{id,name:STANDARD_RESOURCE_DOMAINS.find(domain=>domain.id===id)?.name||entry.name||id});}
        if(page.truncated&&!page.next_cursor)throw Error("Каталог областей неполон");
        cursor=page.next_cursor||"";
      if(!current)return;
      }while(cursor);
      if(current)setDomains([...found.values()]);
    })().catch(()=>{if(current)setDomainsError(true);}).finally(()=>{if(current)setDomainsLoading(false);});
    return()=>{current=false;};
  },[ui,project]);
  const summary=(r:AdminRight)=> r.kind==="capability" ? `Полномочие: ${r.capability}` : `${data.projects.find(p=>p.id===r.project_id)?.name || r.project_id} · ${r.functional_role_id ? roles.find(a=>a.id===r.functional_role_id)?.name || r.functional_role_id : "все предметные области"} · ${r.class==="database"?"база данных":"файлы"} · ${r.mode==="write"?"чтение и запись":"чтение"} · ${r.node_id ? "узел: "+r.node_id : "весь проект"}`;
  const change=async(request=pending)=>{if(!request||busy)return;setBusy(true);setError("");setNotice("");try {if(request.remove){const r=await ui.removePersonRight(request.right);setNotice(r.outcome==="removed"?"Назначение отозвано.":r.outcome==="absent"?"Это назначение уже отсутствует.":r.outcome==="subject_unknown"?"Человек больше не найден в организации.":"Результат отзыва неизвестен. Проверьте список назначений.");}else{await ui.grantPersonRight(request.right);setNotice("Назначение сохранено.");}setPending(null);setEditing(false);setRevision(v=>v+1);}catch{setError("Сервер не подтвердил изменение. Обновите назначения перед повтором.");setPending(null);setRevision(v=>v+1);}finally{setBusy(false);}};
  const projectName=(r:AdminRight)=>data.projects.find(p=>p.id===r.project_id)?.name||"Проект недоступен";
  const domainName=(r:AdminRight)=>r.functional_role_id ? STANDARD_RESOURCE_DOMAINS.find(d=>d.id===r.functional_role_id)?.name||roles.find(d=>d.id===r.functional_role_id)?.name||r.functional_role_id : "Все области";
  return <section aria-label={`Доступ: ${person.displayName||person.userName}`} className="min-w-0">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="m-0 break-words text-base font-semibold">{person.displayName||person.userName}</h2><div className="mt-2"><StatusBadge tone={person.active?"success":"neutral"}>{person.active?"Активен":"Доступ приостановлен"}</StatusBadge></div></div>
      {!editing&&<Button size="sm" variant="secondary" disabled={!rights?.exists||busy} onClick={()=>{setEditing(true);setPending(null);setError("");}}><Plus size={16}/>Дать доступ</Button>}
    </div>
    {error && <Notice tone="danger">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    {!rights && !error && <Notice>Загрузка доступа…</Notice>}
    {rights?.deactivated && <Notice>Сохранённые права сейчас не действуют.</Notice>}
    {rights && <div className="divide-y divide-kumo-line border-y border-kumo-line">
      {rights.rights.map((r,i)=><div key={i} className="flex items-center gap-3 py-4">
        <div className="min-w-0 flex-1"><div className="break-words text-sm font-medium">{r.kind==="capability"?`Полномочие: ${r.capability}`:projectName(r)}</div>
        {r.kind!=="capability"&&<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-kumo-subtle"><span>{domainName(r)}</span><span>{r.mode==="write"?"Чтение и запись":"Чтение"}</span>{r.class==="database"&&<span>База данных</span>}{r.node_id&&<span>Часть проекта</span>}</div>}</div>
        <Button size="sm" variant="ghost" aria-label={`Отозвать доступ: ${projectName(r)}, ${domainName(r)}`} disabled={busy||!!pending} onClick={()=>{setPending({right:r,remove:true});setEditing(false);}}><Trash size={16}/></Button>
      </div>)}
      {!rights.rights.length && <div className="py-6"><Notice>Доступ к проектам ещё не назначен.</Notice></div>}
    </div>}
    {editing&&<form aria-label="Новое назначение" className="grid gap-4 mt-5 rounded-xl border border-kumo-line p-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void change({remove:false,right:{kind:"anchor",principal_id:person.userName,project_id:project,class:resourceClass,mode,node_id:node.trim(),functional_role_id:scope==="all"?"":area}});}}>
      <label className="grid gap-1.5 text-sm">Проект<Select aria-label="Проект" required value={project} onChange={e=>{setProject(e.target.value);setNode("");setScope("area");}}><option value="">Выберите проект</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      {data.projectsError && <Notice tone="danger">Не удалось прочитать проекты.</Notice>}
      <label className="grid gap-1.5 text-sm">Предметная область<Select aria-label="Предметная область материалов" required disabled={busy||domainsLoading||!project} value={scope==="all"?"__all__":area} onChange={e=>{setScope(e.target.value==="__all__"?"all":"area");setArea(e.target.value==="__all__"?"":e.target.value);}}><option value="">{domainsLoading?"Загрузка областей…":"Выберите область"}</option><option value="__all__">Все предметные области</option>{domains.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</Select></label>
      {domainsError && <Notice tone="danger">Не удалось полностью прочитать области материалов проекта. Выберите проект заново.</Notice>}
      {rolesError && <Notice>Названия ролей недоступны; прежние назначения показаны по сохранённым значениям.</Notice>}
      <label className="grid gap-1.5 text-sm">Действия<Select aria-label="Действия" value={mode} onChange={e=>setMode(e.target.value as "read"|"write")}><option value="read">Чтение</option><option value="write">Чтение и запись</option></Select></label>
      <details className="sm:col-span-2 text-sm"><summary className="cursor-pointer text-kumo-subtle">Дополнительные ограничения</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">Ресурс<Select aria-label="Ресурс" value={resourceClass} onChange={e=>setResourceClass(e.target.value as "filesystem"|"database")}><option value="filesystem">Файлы</option><option value="database">База данных</option></Select></label>
        <label className="grid gap-1.5">Узел доступа<TextInput aria-label="Узел доступа" placeholder="Весь проект" value={node} onChange={e=>setNode(e.target.value)} /></label>
      </div></details>
      <div className="sm:col-span-2 flex gap-2"><Button type="submit" disabled={busy||!rights?.exists||!project||(scope==="area"&&(!area||domainsError||domainsLoading))}>{busy?"Сохраняем…":"Сохранить"}</Button><Button variant="ghost" disabled={busy} onClick={()=>{setEditing(false);setPending(null);}}>Отмена</Button></div>
    </form>}
    {pending && <div role="region" aria-label="Подтверждение изменения доступа" className="rounded-xl border border-kumo-line p-4 mt-4"><strong>{pending.remove?"Отозвать":"Добавить"} назначение для {person.displayName||person.userName}</strong><p>{summary(pending.right)}</p>{pending.remove&&<p className="text-sm text-kumo-subtle">Доступ через группы и другие назначения может сохраниться.</p>}<Button disabled={busy} onClick={()=>void change()}>Подтвердить {pending.remove?"отзыв":"назначение"}</Button><Button disabled={busy} variant="secondary" onClick={()=>setPending(null)}>Отмена</Button></div>}
  </section>;
}
