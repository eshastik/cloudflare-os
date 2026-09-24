import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { Plus, Trash, UserPlus } from "@phosphor-icons/react";
import type { MemoryData } from "./data.ts";
import type { AdminPerson, AdminRight, AdminRights } from "../src/admin-people.ts";
import type { OrganizationRole } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { ActionForm, Notice, Select, StatusBadge, TextInput } from "./ui.tsx";
import { DepartmentsPanel, InvitePanel, headedUnits, useOrgUnits } from "./Departments.tsx";
import { AdminSwitch, CompetenciesPanel, PersonCompetencies } from "./Competencies.tsx";

export default function PeopleTab({ data }: { data: MemoryData }) {
  if (!data.identity?.capabilities?.includes("principal.manage")) return <DepartmentHead data={data} />;
  return <PeopleManager data={data} />;
}
/** Руководитель отдела без полномочия управления людьми приглашает сотрудников в свой отдел. */
function DepartmentHead({ data }: { data: MemoryData }) {
  const { units, loading } = useOrgUnits();
  const mine = headedUnits(units, data.identity?.subject?.user_id ?? "");
  if (loading) return <Notice>Проверка доступа…</Notice>;
  if (!mine.length) return <Notice>Управление людьми недоступно для вашей учётной записи.</Notice>;
  return <section aria-label="Мой отдел" className="grid gap-6">
    {mine.map(unit => <div key={unit.org_unit_id}>
      <h2 className="m-0 mb-2 text-base font-semibold">Отдел «{unit.name}»</h2>
      <p className="m-0 text-sm text-kumo-subtle">{unit.members.map(m => m.display_name || "Сотрудник").join(", ")}</p>
    </div>)}
    <InvitePanel units={mine} allowNoUnit={false} admin={false} />
  </section>;
}
/** «Люди и отделы» — одна страница блоками: пригласить (раскрывается на месте), отделы, люди, компетенции. */
function PeopleManager({ data }: { data: MemoryData }) {
  const ui = useUi();
  const [people, setPeople] = useState<AdminPerson[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => { let current = true; setLoading(true); setError("");
    void ui.listPeople().then(p => { if (current) setPeople(p.users); }, () => { if (current) {setPeople([]);setSelected("");setError("Не удалось получить список сотрудников. Обновите страницу.");} }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [ui, revision]);
  const visiblePeople = people.filter(p => `${p.displayName} ${p.userName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <section aria-label="Люди и отделы" className="grid gap-8">
    <section aria-label="Приглашения">
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0 flex-1 text-sm text-kumo-subtle">Сотрудников: {people.length}</p>
        <Button size="sm" variant="primary" aria-expanded={inviting} onClick={() => setInviting(!inviting)}><UserPlus size={16}/>{inviting ? "Свернуть" : "Пригласить"}</Button>
      </div>
      {inviting && <div className="mt-3 rounded-xl border border-kumo-line bg-kumo-elevated p-4"><AdminInvite /></div>}
    </section>
    <div><h2 className="m-0 mb-3 text-[15px] font-semibold text-kumo-strong">Отделы</h2><DepartmentsPanel people={people} /></div>
    <section aria-label="Люди">
      <h2 className="m-0 mb-3 text-[15px] font-semibold text-kumo-strong">Люди</h2>
      <TextInput className="mb-3 w-full max-w-[360px]" type="search" aria-label="Найти сотрудника" placeholder="Найти сотрудника…" value={query} onChange={e => setQuery(e.target.value)} />
      {error && <><Notice tone="danger">{error}</Notice><Button className="mt-2" size="sm" variant="ghost" disabled={loading} onClick={() => setRevision(v => v+1)}>Повторить</Button></>}
      {loading ? <Notice>Загрузка…</Notice> : <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
        {visiblePeople.map(p => <div key={p.userName} className="border-t border-kumo-line first:border-t-0">
          <button type="button" aria-label={`Открыть карточку: ${p.displayName || "сотрудник без имени"}`} aria-expanded={selected === p.userName} onClick={() => setSelected(selected === p.userName ? "" : p.userName)}
            className={`flex w-full items-center gap-3 px-3 py-3 text-left ${selected === p.userName ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}>
            <span className="min-w-0 flex-1 break-words text-sm font-medium">{p.displayName || "Сотрудник без имени"}</span>
            {!p.active && <StatusBadge tone="neutral">Доступ приостановлен</StatusBadge>}
          </button>
          {selected === p.userName && <div className="px-3 pb-4"><PersonCard key={p.userName} person={p} data={data} /></div>}
        </div>)}
        {!error && !people.length && <div className="p-3"><Notice>Сотрудников пока нет. Пригласите первого.</Notice></div>}
        {people.length > 0 && !visiblePeople.length && <div className="p-3"><Notice>По этому запросу никого не найдено.</Notice></div>}
      </div>}
    </section>
    <div><h2 className="m-0 mb-3 text-[15px] font-semibold text-kumo-strong">Компетенции</h2><CompetenciesPanel people={people} /></div>
  </section>;
}
function AdminInvite() {
  const { units, loading } = useOrgUnits();
  if (loading) return <Notice>Загрузка отделов…</Notice>;
  return <InvitePanel units={units} allowNoUnit admin />;
}
const STANDARD_RESOURCE_DOMAINS=[
 {id:"юридический",name:"Юридические вопросы"},{id:"финансовый",name:"Финансовые вопросы"},
 {id:"коммерческий",name:"Коммерческие вопросы"},{id:"технический",name:"Технические вопросы"},
 {id:"административный",name:"Административные вопросы"},{id:"общий",name:"Общие материалы"},
];
/** Полномочия словами; незнакомое не показывается кодом. */
const CAPABILITY_WORDS: Record<string,string> = {"principal.manage":"Управление людьми и правилами","project.create":"Создание проектов","platform.metrics.read":"Просмотр состояния системы"};
const capabilityWords = (capability?: string) => CAPABILITY_WORDS[capability ?? ""] ?? "Особое полномочие";

/** Карточка сотрудника: отделы и руководство, «Администратор», компетенции и проекты — словами. */
function PersonCard({person,data}: {person:AdminPerson;data:MemoryData}) {
  const { units, loading: unitsLoading } = useOrgUnits();
  const own = units.filter(u => u.members.some(m => m.principal_id === person.userName));
  return <section aria-label={`Сотрудник: ${person.displayName||"без имени"}`} className="grid min-w-0 gap-5">
    <section aria-label="Отдел">
      <h3 className="m-0 mb-2 text-[15px] font-semibold">Отдел</h3>
      {unitsLoading ? <Notice>Загрузка…</Notice> : own.length === 0 ? <Notice>Не состоит ни в одном отделе. Добавить можно в разделе «Отделы».</Notice> :
        <p className="m-0 text-[13px]">{own.map(u => `${u.name}${u.members.find(m => m.principal_id === person.userName)?.is_head ? " — руководитель" : ""}`).join("; ")}</p>}
    </section>
    <section aria-label="Права администратора"><h3 className="m-0 mb-2 text-[15px] font-semibold">Права администратора</h3><AdminSwitch person={person} /></section>
    <section aria-label="Компетенции сотрудника"><h3 className="m-0 mb-2 text-[15px] font-semibold">Компетенции</h3><PersonCompetencies person={person} /></section>
    <PersonRights person={person} data={data} />
  </section>;
}

function PersonRights({person,data}: {person:AdminPerson;data:MemoryData}) {
  const ui=useUi(); const [rights,setRights]=useState<AdminRights|null>(null); const [roles,setRoles]=useState<OrganizationRole[]>([]); const [rolesError,setRolesError]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false); const [revision,setRevision]=useState(0);
  const [domains,setDomains]=useState(STANDARD_RESOURCE_DOMAINS),[domainsLoading,setDomainsLoading]=useState(false),[domainsError,setDomainsError]=useState(false);
  const [editing,setEditing]=useState(false);
  const [project,setProject]=useState(""); const [area,setArea]=useState(""); const [scope,setScope]=useState("area"); const [resourceClass,setResourceClass]=useState<"filesystem"|"database">("filesystem"); const [mode,setMode]=useState<"read"|"write">("read"); const [pending,setPending]=useState<{right:AdminRight;remove:boolean}|null>(null);
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
        for(const entry of page.nodes)if(entry.functional_role_id){const id=entry.functional_role_id;found.set(id,{id,name:STANDARD_RESOURCE_DOMAINS.find(domain=>domain.id===id)?.name||entry.name||"Область без названия"});}
        if(page.truncated&&!page.next_cursor)throw Error("Каталог областей неполон");
        cursor=page.next_cursor||"";
      if(!current)return;
      }while(cursor);
      if(current)setDomains([...found.values()]);
    })().catch(()=>{if(current)setDomainsError(true);}).finally(()=>{if(current)setDomainsLoading(false);});
    return()=>{current=false;};
  },[ui,project]);
  const summary=(r:AdminRight)=> r.kind==="capability" ? capabilityWords(r.capability) : `${projectName(r)} · ${domainName(r)} · ${r.class==="database"?"база данных":"файлы"} · ${r.mode==="write"?"чтение и запись":"чтение"} · ${r.node_id ? "часть проекта" : "весь проект"}`;
  const change=async(request=pending)=>{if(!request||busy)return;setBusy(true);setError("");setNotice("");try {if(request.remove){const r=await ui.removePersonRight(request.right);setNotice(r.outcome==="removed"?"Назначение отозвано.":r.outcome==="absent"?"Это назначение уже отсутствует.":r.outcome==="subject_unknown"?"Человек больше не найден в организации.":"Результат отзыва неизвестен. Проверьте список назначений.");}else{await ui.grantPersonRight(request.right);setNotice("Назначение сохранено.");}setPending(null);setEditing(false);setRevision(v=>v+1);}catch{setError("Сервер не подтвердил изменение. Обновите назначения перед повтором.");setPending(null);setRevision(v=>v+1);}finally{setBusy(false);}};
  const projectName=(r:AdminRight)=>data.projects.find(p=>p.id===r.project_id)?.name||"Проект недоступен";
  const domainName=(r:AdminRight)=>r.functional_role_id ? STANDARD_RESOURCE_DOMAINS.find(d=>d.id===r.functional_role_id)?.name||roles.find(d=>d.id===r.functional_role_id)?.name||"Область без названия" : "Все области";
  const grant=()=>{if(busy||!rights?.exists||!project||(scope==="area"&&(!area||domainsError||domainsLoading)))return;void change({remove:false,right:{kind:"anchor",principal_id:person.userName,project_id:project,class:resourceClass,mode,node_id:"",functional_role_id:scope==="all"?"":area}});};
  return <section aria-label="Проекты и доступ" className="min-w-0">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <h3 className="m-0 text-[15px] font-semibold">Проекты и доступ</h3>
      {!editing&&<Button size="sm" variant="secondary" disabled={!rights?.exists||busy} onClick={()=>{setEditing(true);setPending(null);setError("");}}><Plus size={16}/>Дать доступ</Button>}
    </div>
    {error && <Notice tone="danger">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    {!rights && !error && <Notice>Загрузка доступа…</Notice>}
    {rights?.deactivated && <Notice>Сохранённые права сейчас не действуют.</Notice>}
    {rights && <div className="divide-y divide-kumo-line border-y border-kumo-line">
      {rights.rights.map((r,i)=><div key={i} className="flex items-center gap-3 py-4">
        <div className="min-w-0 flex-1"><div className="break-words text-sm font-medium">{r.kind==="capability"?capabilityWords(r.capability):projectName(r)}</div>
        {r.kind!=="capability"&&<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-kumo-subtle"><span>{domainName(r)}</span><span>{r.mode==="write"?"Чтение и запись":"Чтение"}</span>{r.class==="database"&&<span>База данных</span>}{r.node_id&&<span>Часть проекта</span>}</div>}</div>
        <Button size="sm" variant="ghost" aria-label={`Отозвать доступ: ${projectName(r)}, ${domainName(r)}`} disabled={busy||!!pending} onClick={()=>{setPending({right:r,remove:true});setEditing(false);}}><Trash size={16}/></Button>
      </div>)}
      {!rights.rights.length && <div className="py-6"><Notice>Доступ к проектам ещё не назначен.</Notice></div>}
    </div>}
    {editing&&<ActionForm aria-label="Новое назначение" className="grid gap-4 mt-5 rounded-xl border border-kumo-line p-4 sm:grid-cols-2" onAction={grant}>
      <label className="grid gap-1.5 text-sm">Проект<Select aria-label="Проект" required value={project} onChange={e=>{setProject(e.target.value);setScope("area");}}><option value="">Выберите проект</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      {data.projectsError && <Notice tone="danger">Не удалось прочитать проекты.</Notice>}
      <label className="grid gap-1.5 text-sm">Предметная область<Select aria-label="Предметная область материалов" required disabled={busy||domainsLoading||!project} value={scope==="all"?"__all__":area} onChange={e=>{setScope(e.target.value==="__all__"?"all":"area");setArea(e.target.value==="__all__"?"":e.target.value);}}><option value="">{domainsLoading?"Загрузка областей…":"Выберите область"}</option><option value="__all__">Все предметные области</option>{domains.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</Select></label>
      {domainsError && <Notice tone="danger">Не удалось полностью прочитать области материалов проекта. Выберите проект заново.</Notice>}
      {rolesError && <Notice>Названия ролей недоступны; прежние назначения показаны по сохранённым значениям.</Notice>}
      <label className="grid gap-1.5 text-sm">Действия<Select aria-label="Действия" value={mode} onChange={e=>setMode(e.target.value as "read"|"write")}><option value="read">Чтение</option><option value="write">Чтение и запись</option></Select></label>
      <label className="grid gap-1.5 text-sm">Что открыть<Select aria-label="Ресурс" value={resourceClass} onChange={e=>setResourceClass(e.target.value as "filesystem"|"database")}><option value="filesystem">Файлы проекта</option><option value="database">Базы данных проекта</option></Select></label>
      <div className="sm:col-span-2 flex gap-2"><Button type="button" onClick={grant} disabled={busy||!rights?.exists||!project||(scope==="area"&&(!area||domainsError||domainsLoading))}>{busy?"Сохраняем…":"Сохранить"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>{setEditing(false);setPending(null);}}>Отмена</Button></div>
    </ActionForm>}
    {pending && <div role="region" aria-label="Подтверждение изменения доступа" className="rounded-xl border border-kumo-line p-4 mt-4"><strong>{pending.remove?"Отозвать":"Добавить"} назначение для {person.displayName||person.userName}</strong><p>{summary(pending.right)}</p>{pending.remove&&<p className="text-sm text-kumo-subtle">Доступ через группы и другие назначения может сохраниться.</p>}<Button disabled={busy} onClick={()=>void change()}>Подтвердить {pending.remove?"отзыв":"назначение"}</Button><Button disabled={busy} variant="secondary" onClick={()=>setPending(null)}>Отмена</Button></div>}
  </section>;
}
