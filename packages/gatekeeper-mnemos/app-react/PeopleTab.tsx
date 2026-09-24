import { useEffect, useState } from "react";
import { Plus, Trash, UserPlus } from "@phosphor-icons/react";
import type { MemoryData } from "./data.ts";
import type { AdminPerson, AdminRight, AdminRights } from "../src/admin-people.ts";
import type { OrganizationRole, OrgUnit } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { ActionForm, Notice, StatusBadge } from "./ui.tsx";
import { DepartmentsPanel, InvitationRows, InvitePanel, InviteForm, headedUnits, useInvitations, useOrgUnits } from "./Departments.tsx";
import { AdminSwitch, CodeAgentSwitch, CompetenciesPanel, PersonCompetencies } from "./Competencies.tsx";
import { Card, CardRow, Field, FieldSelect, Initials, Pill, PillInput, RowTitle, SectionHead } from "./admin-ui.tsx";

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
    {mine.map(unit => <section key={unit.org_unit_id} aria-label={`Отдел ${unit.name}`}>
      <SectionHead title={`Отдел «${unit.name}»`} />
      <Card>{unit.members.map(m => <CardRow key={m.principal_id}><Initials name={m.display_name || "Сотрудник"} /><RowTitle title={m.display_name || "Сотрудник"} note={m.is_head ? "руководитель" : undefined} /></CardRow>)}
        {!unit.members.length && <CardRow><Notice>В отделе пока никого нет.</Notice></CardRow>}</Card>
    </section>)}
    <InvitePanel units={mine} allowNoUnit={false} admin={false} />
  </section>;
}

/** Отдел сотрудника словами: «Закупки · руководитель»; без отдела — так и сказано. */
function unitWords(units: OrgUnit[], person: string): string {
  const own = units.filter(u => u.members.some(m => m.principal_id === person));
  if (!own.length) return "без отдела";
  return own.map(u => `${u.name}${u.members.find(m => m.principal_id === person)?.is_head ? " · руководитель" : ""}`).join("; ");
}

/** «Люди и отделы» — одна страница: приглашение (раскрывается на месте), отделы и люди рядом, компетенции ниже. */
function PeopleManager({ data }: { data: MemoryData }) {
  const ui = useUi();
  const org = useOrgUnits();
  const invitations = useInvitations();
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
  const needle = query.toLocaleLowerCase().trim();
  // Удалённые из организации в общем списке не показываются: у них своя свёрнутая строка «Бывшие сотрудники».
  const current = people.filter(p => p.active !== false);
  const former = people.filter(p => p.active === false);
  const me = data.identity?.subject?.user_id ?? "";
  const reload = () => { setSelected(""); setRevision(v => v + 1); };
  const visiblePeople = current.filter(p => `${p.displayName} ${p.userName}`.toLocaleLowerCase().includes(needle));
  const openInvitations = (invitations.list ?? []).filter(i => i.status === "open" && (!needle || `${i.display_name} ${i.email}`.toLocaleLowerCase().includes(needle)));
  return <section aria-label="Люди и отделы" className="grid gap-8">
    <section aria-label="Приглашения" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0 flex-1 text-[15px] text-kumo-subtle">Сотрудников: {current.length}{openInvitations.length ? ` · приглашены и ещё не вошли: ${openInvitations.length}` : ""}</p>
        <Pill tone="primary" size="md" aria-expanded={inviting} onClick={() => setInviting(!inviting)}><UserPlus size={16} />{inviting ? "Свернуть" : "Пригласить"}</Pill>
      </div>
      {inviting && (org.loading ? <Notice>Загрузка отделов…</Notice> : <InviteForm units={org.units} allowNoUnit admin onCreated={invitations.reload} />)}
    </section>
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <DepartmentsPanel people={current} org={org} />
      <section aria-label="Люди" className="min-w-0">
        <SectionHead title="Люди"><PillInput type="search" aria-label="Найти сотрудника" placeholder="Найти" className="w-[180px]" value={query} onChange={e => setQuery(e.target.value)} /></SectionHead>
        {error && <div className="mb-2 flex flex-wrap items-center gap-2"><Notice tone="danger">{error}</Notice><Pill tone="ghost" disabled={loading} onClick={() => setRevision(v => v+1)}>Повторить</Pill></div>}
        {loading ? <Notice>Загрузка…</Notice> : <Card>
          {visiblePeople.map(p => {
            const name = p.displayName || "Сотрудник без имени";
            const open = selected === p.userName;
            return <div key={p.userName} className={`border-t border-kumo-fill first:border-t-0 ${open ? "bg-kumo-base" : ""}`}>
              <button type="button" aria-label={`Открыть карточку: ${p.displayName || "сотрудник без имени"}`} aria-expanded={open} onClick={() => setSelected(open ? "" : p.userName)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-kumo-tint">
                <Initials name={name} />
                <RowTitle title={name} note={org.loading ? undefined : unitWords(org.units, p.userName)} />
                {!p.active && <StatusBadge tone="neutral">Доступ приостановлен</StatusBadge>}
              </button>
              {open && <div className="px-4 pb-4 sm:pl-[62px]"><PersonCard key={p.userName} person={p} data={data} units={org.units} unitsLoading={org.loading} self={p.userName === me} onRemoved={() => { reload(); org.reload(); }} /></div>}
            </div>;
          })}
          {invitations.list && <InvitationRows list={openInvitations} onChanged={invitations.reload} />}
          {!error && !current.length && !openInvitations.length && <CardRow><Notice>Сотрудников пока нет. Пригласите первого.</Notice></CardRow>}
          {current.length > 0 && !visiblePeople.length && <CardRow><Notice>По этому запросу никого не найдено.</Notice></CardRow>}
        </Card>}
        {!loading && former.length > 0 && <FormerPeople people={former} onChanged={reload} />}
        {invitations.failed && <div className="mt-2"><Notice tone="danger">Список приглашений недоступен.</Notice></div>}
      </section>
    </div>
    <CompetenciesPanel people={current} />
  </section>;
}
const STANDARD_RESOURCE_DOMAINS=[
 {id:"юридический",name:"Юридические вопросы"},{id:"финансовый",name:"Финансовые вопросы"},
 {id:"коммерческий",name:"Коммерческие вопросы"},{id:"технический",name:"Технические вопросы"},
 {id:"административный",name:"Административные вопросы"},{id:"общий",name:"Общие материалы"},
];
/** Полномочия словами; незнакомое не показывается кодом. */
const CAPABILITY_WORDS: Record<string,string> = {"principal.manage":"Управление людьми и правилами","project.create":"Создание проектов","platform.metrics.read":"Просмотр состояния системы","code.agent.use":"Агент кода"};
const capabilityWords = (capability?: string) => CAPABILITY_WORDS[capability ?? ""] ?? "Особое полномочие";

/** Раскрытая строка сотрудника: отдел словами, компетенции метками, «Администратор» и доступ к проектам. */
function PersonCard({person,data,units,unitsLoading,self,onRemoved}: {person:AdminPerson;data:MemoryData;units:OrgUnit[];unitsLoading:boolean;self:boolean;onRemoved():void}) {
  const own = units.filter(u => u.members.some(m => m.principal_id === person.userName));
  return <section aria-label={`Сотрудник: ${person.displayName||"без имени"}`} className="grid min-w-0 gap-4">
    <section aria-label="Отдел" className="text-[13px]">
      {unitsLoading ? <Notice>Загрузка…</Notice> : own.length === 0 ? <Notice>Не состоит ни в одном отделе. Добавить можно в строке отдела слева.</Notice> :
        <p className="m-0">Отдел: {own.map(u => `${u.name}${u.members.find(m => m.principal_id === person.userName)?.is_head ? " — руководитель" : ""}`).join("; ")}</p>}
    </section>
    <section aria-label="Компетенции сотрудника"><PersonCompetencies person={person} /></section>
    <section aria-label="Права администратора"><AdminSwitch person={person} /></section>
    <PersonRights person={person} data={data} />
    <RemovePerson person={person} self={self} onRemoved={onRemoved} />
  </section>;
}

/** «Удалить из организации»: подтверждение в строке, сохраняется сразу. Учётная запись остаётся ради истории и авторства. */
function RemovePerson({person,self,onRemoved}: {person:AdminPerson;self:boolean;onRemoved():void}) {
  const ui = useUi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = person.displayName || "сотрудника";
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await ui.removePerson(person.userName); setConfirming(false); onRemoved(); }
    catch { setError("Сотрудник не удалён. Последнего администратора удалить нельзя — сначала назначьте другого; если дело не в этом, обновите страницу и повторите."); }
    finally { setBusy(false); }
  };
  if (self) return <section aria-label="Удаление из организации"><p className="m-0 text-[13px] text-kumo-subtle">Себя из организации удалить нельзя.</p></section>;
  return <section aria-label="Удаление из организации" className="grid gap-2 border-t border-kumo-fill pt-3">
    {!confirming && <div><Pill tone="danger" disabled={busy} onClick={() => { setConfirming(true); setError(""); }}><Trash size={14} />Удалить из организации</Pill></div>}
    {confirming && <div role="region" aria-label={`Подтверждение удаления: ${name}`} className="grid gap-2 rounded-xl bg-kumo-tint p-3 text-[13px]">
      <p className="m-0">Удалить {name} из организации? Вход и ключи доступа перестанут работать, агенты сотрудника отключатся, приглашения к документам и доступ к проектам снимутся, из отделов и компетенций сотрудник уйдёт.</p>
      <p className="m-0 text-kumo-subtle">Учётная запись и авторство версий сохранятся. Вернуть можно в «Бывших сотрудниках» ниже списка — доступ к проектам тогда выдаётся заново.</p>
      <div className="flex gap-2">
        <Pill tone="danger" disabled={busy} onClick={() => void remove()}>{busy ? "Удаляем…" : "Удалить"}</Pill>
        <Pill tone="ghost" disabled={busy} onClick={() => setConfirming(false)}>Отмена</Pill>
      </div>
    </div>}
    {error && <Notice tone="danger">{error}</Notice>}
  </section>;
}

/** Бывшие сотрудники: свёрнуты под списком, «Вернуть» открывает вход снова, без прежних прав. */
function FormerPeople({people,onChanged}: {people:AdminPerson[];onChanged():void}) {
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{tone:"success"|"danger";text:string}|null>(null);
  const restore = async (p: AdminPerson) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await ui.returnPerson(p.userName); setNotice({ tone: "success", text: `${p.displayName || "Сотрудник"} снова в организации. Доступ к проектам выдайте в карточке.` }); onChanged(); }
    catch { setNotice({ tone: "danger", text: "Сотрудник не возвращён. Обновите страницу и повторите." }); }
    finally { setBusy(false); }
  };
  return <details aria-label="Бывшие сотрудники" className="mt-3 text-[13px]">
    <summary className="cursor-pointer text-kumo-subtle">Бывшие сотрудники: {people.length}</summary>
    <Card className="mt-2">{people.map(p => <CardRow key={p.userName}>
      <Initials name={p.displayName || "Сотрудник"} />
      <RowTitle title={p.displayName || "Сотрудник без имени"} note="удалён из организации" />
      <Pill tone="ghost" aria-label={`Вернуть: ${p.displayName || "сотрудник без имени"}`} disabled={busy} onClick={() => void restore(p)}>Вернуть</Pill>
    </CardRow>)}</Card>
    {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
  </details>;
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
  const canGrant=!busy&&!!rights?.exists&&!!project&&!(scope==="area"&&(!area||domainsError||domainsLoading));
  // «Агент кода» читается из тех же назначений: одно чтение прав на карточку.
  const ownCodeAgent=rights?rights.rights.some(r=>r.kind==="capability"&&r.capability==="code.agent.use"):error?null:undefined;
  return <>
  <section aria-label="Агент кода"><CodeAgentSwitch person={person} own={ownCodeAgent} onChanged={()=>setRevision(v=>v+1)} /></section>
  <section aria-label="Проекты и доступ" className="min-w-0">
    <div className="mb-1 flex flex-wrap items-center gap-3">
      <h3 className="m-0 flex-1 text-[14px] font-semibold">Проекты и доступ</h3>
      {!editing&&<Pill disabled={!rights?.exists||busy} onClick={()=>{setEditing(true);setPending(null);setError("");}}><Plus size={14}/>Дать доступ</Pill>}
    </div>
    {error && <Notice tone="danger">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    {!rights && !error && <Notice>Загрузка доступа…</Notice>}
    {rights?.deactivated && <Notice>Сохранённые права сейчас не действуют.</Notice>}
    {rights && <div>
      {/* «Агент кода» меняется своим переключателем выше, в списке назначений его нет. */}
      {rights.rights.filter(r=>!(r.kind==="capability"&&r.capability==="code.agent.use")).map((r,i)=><div key={i} className="flex items-center gap-3 border-t border-kumo-fill py-2.5 first:border-t-0">
        <div className="min-w-0 flex-1"><div className="break-words text-[14px] font-medium">{r.kind==="capability"?capabilityWords(r.capability):projectName(r)}</div>
        {r.kind!=="capability"&&<div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-kumo-subtle"><span>{domainName(r)}</span><span>{r.mode==="write"?"Чтение и запись":"Чтение"}</span>{r.class==="database"&&<span>База данных</span>}{r.node_id&&<span>Часть проекта</span>}</div>}</div>
        <Pill tone="ghost" aria-label={`Отозвать доступ: ${projectName(r)}, ${domainName(r)}`} disabled={busy||!!pending} onClick={()=>{setPending({right:r,remove:true});setEditing(false);}}><Trash size={14}/></Pill>
      </div>)}
      {!rights.rights.some(r=>!(r.kind==="capability"&&r.capability==="code.agent.use")) && <p className="m-0 py-1 text-[13px] text-kumo-subtle">Доступ к проектам ещё не назначен.</p>}
    </div>}
    {editing&&<ActionForm aria-label="Новое назначение" className="mt-3 grid gap-3 rounded-2xl border border-kumo-fill bg-kumo-overlay p-4 sm:grid-cols-2" onAction={grant}>
      <Field label="Проект"><FieldSelect aria-label="Проект" required value={project} onChange={e=>{setProject(e.target.value);setScope("area");}}><option value="">Выберите проект</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</FieldSelect></Field>
      {data.projectsError && <Notice tone="danger">Не удалось прочитать проекты.</Notice>}
      <Field label="Предметная область"><FieldSelect aria-label="Предметная область материалов" required disabled={busy||domainsLoading||!project} value={scope==="all"?"__all__":area} onChange={e=>{setScope(e.target.value==="__all__"?"all":"area");setArea(e.target.value==="__all__"?"":e.target.value);}}><option value="">{domainsLoading?"Загрузка областей…":"Выберите область"}</option><option value="__all__">Все предметные области</option>{domains.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</FieldSelect></Field>
      {domainsError && <Notice tone="danger">Не удалось полностью прочитать области материалов проекта. Выберите проект заново.</Notice>}
      {rolesError && <Notice>Названия ролей недоступны; прежние назначения показаны по сохранённым значениям.</Notice>}
      <Field label="Действия"><FieldSelect aria-label="Действия" value={mode} onChange={e=>setMode(e.target.value as "read"|"write")}><option value="read">Чтение</option><option value="write">Чтение и запись</option></FieldSelect></Field>
      <Field label="Что открыть"><FieldSelect aria-label="Ресурс" value={resourceClass} onChange={e=>setResourceClass(e.target.value as "filesystem"|"database")}><option value="filesystem">Файлы проекта</option><option value="database">Базы данных проекта</option></FieldSelect></Field>
      <div className="flex gap-2 sm:col-span-2"><Pill tone="primary" onClick={grant} disabled={!canGrant}>{busy?"Сохраняем…":"Сохранить"}</Pill><Pill tone="ghost" disabled={busy} onClick={()=>{setEditing(false);setPending(null);}}>Отмена</Pill></div>
    </ActionForm>}
    {pending && <div role="region" aria-label="Подтверждение изменения доступа" className="mt-3 grid gap-2 rounded-xl bg-kumo-tint p-3 text-[13px]"><strong className="font-medium">{pending.remove?"Отозвать":"Добавить"} назначение для {person.displayName||"сотрудника"}</strong><p className="m-0">{summary(pending.right)}</p>{pending.remove&&<p className="m-0 text-kumo-subtle">Доступ через группы и другие назначения может сохраниться.</p>}<div className="flex gap-2"><Pill tone="primary" disabled={busy} onClick={()=>void change()}>Подтвердить {pending.remove?"отзыв":"назначение"}</Pill><Pill tone="ghost" disabled={busy} onClick={()=>setPending(null)}>Отмена</Pill></div></div>}
  </section>
  </>;
}
