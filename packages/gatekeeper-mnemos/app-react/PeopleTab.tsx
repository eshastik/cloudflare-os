import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { MemoryData } from "./data.ts";
import type { AdminPerson, AdminRight, AdminRights } from "../src/admin-people.ts";
import type { OrganizationRole } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { Block, Notice, Row, RowList, RowText, Select, TextInput } from "./ui.tsx";
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
        <Button variant="secondary" onClick={() => legacy.open({kind:"roleMembership"}, "Группы и компетенции")}>Группы и компетенции</Button>
        <Button variant="primary" onClick={() => setAdding(!adding)}>Добавить человека</Button>
      </div>
    </div>
    {adding && <div className="mb-5 rounded-xl border border-kumo-line bg-kumo-elevated p-5"><CreatePerson onCreated={userName => {setAdding(false); setSelected(userName); setRevision(v => v+1);}} /></div>}
    {error && <Notice tone="danger">{error}</Notice>}
    <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside aria-label="Сотрудники" className="rounded-xl border border-kumo-line bg-kumo-elevated p-3">
        <TextInput type="search" aria-label="Найти сотрудника" placeholder="Найти сотрудника…" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="mt-3 flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {loading ? <Notice>Загрузка людей…</Notice> : visiblePeople.map(p => <button key={p.userName} type="button" aria-label={`Настроить доступ: ${p.displayName || p.userName}`} aria-pressed={selected === p.userName} onClick={() => setSelected(p.userName)} className={`rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumo-ring ${selected === p.userName ? "bg-kumo-fill text-kumo-strong" : "hover:bg-kumo-tint"}`}>
            <span className="block text-sm font-medium">{p.displayName || p.userName}</span>
            <span className="mt-1 block text-xs text-kumo-subtle">{p.active ? "Активен" : "Доступ приостановлен"}</span>
          </button>)}
        </div>
        {!loading && !error && !people.length && <Notice>Добавьте первого сотрудника.</Notice>}
        {!loading && people.length > 0 && !visiblePeople.length && <Notice>По этому запросу никого не найдено.</Notice>}
        <Button className="mt-3" size="sm" variant="ghost" disabled={loading} onClick={() => setRevision(v => v+1)}>Обновить список</Button>
      </aside>
      <div className="min-w-0">{person ? <PersonRights key={person.userName} person={person} data={data} /> : <div className="rounded-xl border border-dashed border-kumo-line px-6 py-12 text-center"><h2 className="text-base font-medium">Выберите сотрудника</h2><p className="mx-auto max-w-sm text-sm text-kumo-subtle">Здесь появятся его назначения по проектам и предметным областям. Вы сможете добавить или отозвать конкретное право.</p></div>}</div>
    </div>
  </section></LegacySwitch>;
}
function CreatePerson({onCreated}: {onCreated(userName: string): void}) {
  const ui = useUi(); const [name,setName]=useState(""); const [id,setId]=useState(() => crypto.randomUUID()); const [issuer,setIssuer]=useState(""); const [subject,setSubject]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  return <form className="grid gap-3 my-4" onSubmit={e => { e.preventDefault();setBusy(true);setError("");void ui.createPerson({issuer:issuer.trim(),user:{userName:id.trim(),externalId:subject.trim(),displayName:name.trim()}}).then(()=>onCreated(id.trim()),()=>setError("Не удалось добавить человека. Проверьте идентификаторы провайдера и полномочия.")).finally(()=>setBusy(false)); }}>
    <label>Имя<TextInput required value={name} onChange={e=>setName(e.target.value)} /></label>
    <details open><summary>Учётная запись провайдера входа</summary>
      <p>Это регистрация существующей личности. Письмо с приглашением не отправляется. Значения выдаёт администратор провайдера входа.</p>
      <details><summary>Внутренний идентификатор</summary><p>Создан автоматически. Меняйте его только для связи с существующей записью.</p><label>Идентификатор человека в Mnemos<TextInput required value={id} onChange={e=>setId(e.target.value)} /></label></details>
      <label>Адрес издателя удостоверения (issuer)<TextInput required value={issuer} onChange={e=>setIssuer(e.target.value)} /></label>
      <label>Устойчивый идентификатор у провайдера (subject)<TextInput required value={subject} onChange={e=>setSubject(e.target.value)} /></label>
    </details>
    {error && <Notice tone="danger">{error}</Notice>}<Button type="submit" disabled={busy}>Добавить человека</Button>
  </form>;
}
function PersonRights({person,data}: {person:AdminPerson;data:MemoryData}) {
  const ui=useUi(); const [rights,setRights]=useState<AdminRights|null>(null); const [roles,setRoles]=useState<OrganizationRole[]>([]); const [rolesError,setRolesError]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false); const [revision,setRevision]=useState(0);
  const [project,setProject]=useState(""); const [area,setArea]=useState(""); const [scope,setScope]=useState("area"); const [node,setNode]=useState(""); const [resourceClass,setResourceClass]=useState<"filesystem"|"database">("filesystem"); const [mode,setMode]=useState<"read"|"write">("read"); const [pending,setPending]=useState<{right:AdminRight;remove:boolean}|null>(null);
  useEffect(()=>{let current=true;setRights(null);setError("");void ui.listPersonRights(person.userName).then(r=>{if(current)setRights(r);},()=>{if(current)setError("Не удалось прочитать текущие назначения. Изменения недоступны.");});return()=>{current=false;};},[ui,person.userName,revision]);
  useEffect(()=>{let current=true;void (async()=>{const all:OrganizationRole[]=[];let cursor="";do {const page=await ui.listOrganizationRoles(cursor);all.push(...page.roles);cursor=page.next_cursor;}while(cursor);if(current)setRoles(all.filter(r=>r.active&&r.kind==="functional_role"));})().catch(()=>{if(current)setRolesError(true);});return()=>{current=false;};},[ui]);
  const summary=(r:AdminRight)=> r.kind==="capability" ? `Полномочие: ${r.capability}` : `${data.projects.find(p=>p.id===r.project_id)?.name || r.project_id} · ${r.functional_role_id ? roles.find(a=>a.id===r.functional_role_id)?.name || r.functional_role_id : "все предметные области"} · ${r.class==="database"?"база данных":"файлы"} · ${r.mode==="write"?"чтение и запись":"чтение"} · ${r.node_id ? "узел: "+r.node_id : "весь проект"}`;
  const change=async()=>{if(!pending)return;setBusy(true);setError("");setNotice("");try {if(pending.remove){const r=await ui.removePersonRight(pending.right);setNotice(r.outcome==="removed"?"Назначение отозвано.":r.outcome==="absent"?"Это назначение уже отсутствует.":r.outcome==="subject_unknown"?"Человек больше не найден в организации.":"Результат отзыва неизвестен. Проверьте список назначений.");}else{await ui.grantPersonRight(pending.right);setNotice("Назначение сохранено.");}setPending(null);setRevision(v=>v+1);}catch{setError("Сервер не подтвердил изменение. Обновите назначения перед повтором.");setPending(null);setRevision(v=>v+1);}finally{setBusy(false);}};
  return <Block title={`Доступ: ${person.displayName||person.userName}`}>
    {error && <Notice tone="danger">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    {!rights && !error && <Notice>Загрузка назначений…</Notice>}
    {rights?.deactivated && <Notice>Человек неактивен. Сохранённые права сейчас не действуют.</Notice>}
    {rights && <><p>Показаны прямые назначения. Доступ через группы и другие назначения может сохраниться после отзыва одной строки.</p><RowList>{rights.rights.map((r,i)=><Row key={i}><RowText title={summary(r)} /><Button disabled={busy} variant="secondary" onClick={()=>setPending({right:r,remove:true})}>Отозвать назначение</Button></Row>)}</RowList>{!rights.rights.length && <Notice>Прямых назначений нет.</Notice>}</>}
    <form className="grid gap-3 mt-5 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();setPending({remove:false,right:{kind:"anchor",principal_id:person.userName,project_id:project,class:resourceClass,mode,node_id:node.trim(),functional_role_id:scope==="all"?"":area}});}}>
      <label>Проект<Select required value={project} onChange={e=>{setProject(e.target.value);setNode("");}}><option value="">Выберите проект</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      {data.projectsError && <Notice tone="danger">Не удалось прочитать проекты.</Notice>}
      <label>Область доступа<Select value={scope} onChange={e=>setScope(e.target.value)}><option value="area">Одна предметная область</option><option value="all">Все предметные области</option></Select></label>
      {scope==="area" && <label>Предметная область ресурса<Select required value={area} onChange={e=>setArea(e.target.value)}><option value="">Выберите область</option>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</Select></label>}
      {rolesError && <Notice tone="danger">Не удалось прочитать предметные области. Обновите страницу.</Notice>}
      <label>Ресурс<Select value={resourceClass} onChange={e=>setResourceClass(e.target.value as "filesystem"|"database")}><option value="filesystem">Файлы</option><option value="database">База данных</option></Select></label>
      <label>Действия<Select value={mode} onChange={e=>setMode(e.target.value as "read"|"write")}><option value="read">Чтение</option><option value="write">Чтение и запись</option></Select></label>
      <details className="sm:col-span-2"><summary>Ограничить узлом</summary><p>Пустое значение означает весь проект в выбранной предметной области. Укажите точный идентификатор узла, чтобы сузить доступ.</p><TextInput aria-label="Узел доступа" value={node} onChange={e=>setNode(e.target.value)} /></details>
      <Button type="submit" disabled={busy||!rights?.exists||!project||(scope==="area"&&(!area||rolesError))}>Проверить назначение</Button>
    </form>
    {pending && <div role="region" aria-label="Подтверждение изменения доступа" className="rounded-xl border border-kumo-line p-4 mt-4"><strong>{pending.remove?"Отозвать":"Добавить"} назначение для {person.displayName||person.userName}</strong><p>{summary(pending.right)}</p><p>Остальные назначения сохраняются. Согласование документов настраивается отдельно.</p><Button disabled={busy} onClick={()=>void change()}>Подтвердить {pending.remove?"отзыв":"назначение"}</Button><Button disabled={busy} variant="secondary" onClick={()=>setPending(null)}>Отмена</Button></div>}
  </Block>;
}
