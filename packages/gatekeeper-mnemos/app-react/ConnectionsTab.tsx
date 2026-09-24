import { useState, type ReactNode } from "react";
import { CalendarBlank, Code, Database, Envelope, Folder, TelegramLogo } from "@phosphor-icons/react";
import { useUi } from "./host.ts";
import { agentNames, projectName, useLoad, type MemoryData } from "./data.ts";
import { ActionForm, Notice, StatusBadge } from "./ui.tsx";
import { Field, FieldInput, FieldSelect, Pill, PillSelect, RowTitle } from "./admin-ui.tsx";

const FAILURE = "не удалось прочитать подключения. Обновите страницу.";

function timeOf(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? "" : new Date(at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
const lastLoad = (a: { last_success_at?: string }) => a.last_success_at ? `последняя загрузка ${timeOf(a.last_success_at)}` : "материалов ещё не загружало";
const loadProblem = (a: { last_error_at?: string }) => a.last_error_at ? `последняя попытка чтения не удалась (${timeOf(a.last_error_at)})` : "";

/** Строка подключения: что это, работает ли, и «Отключить» с подтверждением на месте. */
interface Item { key: string; title: string; note: string; problem: string; disconnect?: () => Promise<unknown> }

const ICONS = { mail: Envelope, calendar: CalendarBlank, drive: Folder, code: Code, database: Database, telegram: TelegramLogo } as const;

/** «Подключения»: одна карточка, строка на вид источника. Подключение настраивается прямо в строке,
 * без адресов серверов, служебных учётных записей и технических строк. */
export default function ConnectionsTab({ data }: { data: MemoryData }) {
  return <section aria-label="Подключения организации" className="max-w-[820px]">
    <div className="overflow-hidden rounded-2xl border border-kumo-fill bg-kumo-overlay">
      <MailRow data={data} />
      <CalendarRow data={data} />
      <DriveRow />
      <GitRow data={data} />
      <DatabaseRow data={data} />
      <TelegramRow data={data} />
    </div>
  </section>;
}

/** Строка источника: значок, название, состояние словами, кнопка справа. Подключения источника — строками ниже,
 * настройка и форма «Подключить» раскрываются в этой же строке. */
function ConnectionRow({ title, icon, what, loading, error, items, connect, connectLabel, reload, extra }: { title: string; icon: keyof typeof ICONS; what: string; loading: boolean; error: string; items: Item[]; connect?: (done: () => void) => ReactNode; connectLabel?: string; reload(): Promise<void>; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const broken = items.filter(i => i.problem).length;
  const state = loading ? "Загрузка…" : error ? `Не удалось прочитать: ${error}` : items.length === 0 ? `Не подключено. ${what}` : broken ? `Подключено: ${items.length}; требуют внимания: ${broken}.` : `Работает · подключено: ${items.length}.`;
  const Icon = ICONS[icon];
  async function disconnect(item: Item) {
    if (busy || !item.disconnect) return;
    setBusy(true); setNotice(null);
    try { await item.disconnect(); setNotice({ tone: "success", text: `«${item.title}» отключено.` }); setConfirm(""); await reload(); }
    catch { setNotice({ tone: "danger", text: "Отключение не подтверждено. Обновите страницу и проверьте ещё раз." }); }
    finally { setBusy(false); }
  }
  return <section aria-label={title} className="border-t border-kumo-fill first:border-t-0">
    <div className="flex items-center gap-3.5 px-5 py-4">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-kumo-tint text-kumo-default"><Icon size={18} /></span>
      <span className="block min-w-0 flex-1">
        <h2 className="m-0 text-[15px] font-medium text-kumo-default">{title}</h2>
        <p role="status" className={`m-0 text-[13px] ${error || broken ? "text-kumo-danger" : "text-kumo-subtle"}`}>{state}</p>
      </span>
      {connect && <Pill tone={items.length ? "secondary" : "primary"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Свернуть" : items.length ? "Настроить" : connectLabel ?? "Подключить"}</Pill>}
    </div>
    {(items.length > 0 || notice || open) && <div className="grid gap-2 px-5 pb-4 sm:pl-[70px]">
      {items.length > 0 && <p className="m-0 text-[13px] text-kumo-subtle">{what}</p>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {items.map(item => <div key={item.key} data-connection="" className="flex flex-wrap items-center gap-2 rounded-xl bg-kumo-base px-3 py-2.5">
        <RowTitle title={item.title} note={item.problem ? <span className="text-kumo-danger">Не работает: {item.problem}</span> : item.note} />
        <StatusBadge tone={item.problem ? "danger" : "success"}>{item.problem ? "Требует внимания" : "Работает"}</StatusBadge>
        {item.disconnect && confirm !== item.key && <Pill tone="ghost" disabled={busy} onClick={() => setConfirm(item.key)}>Отключить</Pill>}
        {item.disconnect && confirm === item.key && <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-kumo-subtle">Отключить?</span>
          <Pill tone="primary" disabled={busy} onClick={() => void disconnect(item)}>Да, отключить</Pill>
          <Pill tone="ghost" disabled={busy} onClick={() => setConfirm("")}>Отмена</Pill>
        </span>}
      </div>)}
      {open && extra}
      {open && connect && <div className="rounded-2xl border border-kumo-fill p-4">{connect(() => { setOpen(false); void reload(); })}</div>}
    </div>}
  </section>;
}

/** Форма подключения аккаунта по логину и паролю приложения: сервис выбирается по названию. */
function AccountForm({ services, what, onConnect, extra, done }: { services: { id: string; title: string }[]; what: string; onConnect(input: { server: string; username: string; password: string; extra: boolean }): Promise<unknown>; extra?: string; done(): void }) {
  const [server, setServer] = useState(services[0]?.id ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [flag, setFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (busy || !server || !username.trim() || !password) return;
    setBusy(true); setError("");
    try { await onConnect({ server, username: username.trim(), password, extra: flag }); setPassword(""); done(); }
    catch { setPassword(""); setError("Не подключилось. Проверьте логин и пароль приложения и повторите."); }
    finally { setBusy(false); }
  }
  if (!services.length) return <Notice>Администратор сервера ещё не добавил ни одного сервиса. Попросите его настроить подключение.</Notice>;
  return <ActionForm aria-label={`Подключить: ${what}`} onAction={() => void submit()} className="grid max-w-[480px] gap-3 text-[14px]">
    <Field label="Сервис"><FieldSelect aria-label="Сервис" value={server} disabled={busy} onChange={e => setServer(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</FieldSelect></Field>
    <Field label="Логин"><FieldInput aria-label="Логин" autoComplete="username" value={username} disabled={busy} onChange={e => setUsername(e.target.value)} placeholder="name@company.ru" /></Field>
    <Field label="Пароль приложения"><FieldInput aria-label="Пароль приложения" type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></Field>
    <p className="m-0 text-[12px] text-kumo-subtle">Пароль приложения создаётся в настройках почты или календаря. Он хранится на сервере памяти и не передаётся агентам.</p>
    {extra && <label className="flex items-center gap-2"><input type="checkbox" checked={flag} disabled={busy} onChange={e => setFlag(e.target.checked)} />{extra}</label>}
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Pill tone="primary" disabled={busy || !server || !username.trim() || !password} onClick={() => void submit()}>{busy ? "Подключаем…" : "Подключить"}</Pill></div>
  </ActionForm>;
}

function MailRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const accounts = useLoad(() => ui.listImapAccounts(), FAILURE, [ui]);
  const projectMail = useLoad(() => ui.listMailConnections(""), FAILURE, [ui]);
  const reload = async () => { await Promise.all([accounts.reload(), projectMail.reload()]); };
  const items: Item[] = [
    ...(accounts.value?.accounts ?? []).map(a => ({ key: `imap/${a.id}`, title: `${accounts.value?.servers.find(s => s.id === a.server)?.title ?? "Почта"} · ${a.username}`,
      note: `${a.send_from ? "читает и отправляет письма после вашего согласования" : "только читает письма"} · ${lastLoad(a)}`, problem: a.enabled ? loadProblem(a) : "подключение проверяется", disconnect: () => ui.removeImapAccount(a.id) })),
    ...(projectMail.value?.connections ?? []).map(c => ({ key: `mail/${c.connection_id}`, title: `Письма для проекта «${projectName(data.projects, c.project_id)}»`, note: lastLoad(c),
      problem: c.enabled ? loadProblem(c) : "отключено", disconnect: c.enabled ? () => ui.disableMailConnection(c.connection_id, c.revision) : undefined })),
  ];
  const enabled = (projectMail.value?.connections ?? []).filter(c => c.enabled);
  return <ConnectionRow title="Почта" icon="mail" what="Письма попадают в память; агент отвечает только после вашего согласования." loading={accounts.loading || projectMail.loading} error={accounts.error || projectMail.error} items={items} reload={reload}
    extra={enabled.length > 0 && <ReadGrants data={data} kind="mail" connections={enabled.map(c => ({ id: c.connection_id, title: `Письма для проекта «${projectName(data.projects, c.project_id)}»` }))} />}
    connect={done => <AccountForm what="почта" done={done} services={accounts.value?.servers ?? []} extra="Разрешить отправлять письма с этого адреса (каждое — после моего согласования)"
      onConnect={({ server, username, password, extra }) => ui.connectImapAccount({ request: crypto.randomUUID(), server, username, password, mailbox: "INBOX", ...(extra ? { smtp: { from: username, username, password } } : {}) })} />} />;
}

function CalendarRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const accounts = useLoad(() => ui.listCalDAVAccounts(), FAILURE, [ui]);
  const projectCalendars = useLoad(() => ui.listCalendarConnections(""), FAILURE, [ui]);
  const reload = async () => { await Promise.all([accounts.reload(), projectCalendars.reload()]); };
  const items: Item[] = [
    ...(accounts.value?.accounts ?? []).map(a => ({ key: `caldav/${a.id}`, title: `${accounts.value?.servers.find(s => s.id === a.server)?.title ?? "Календарь"} · ${a.username}`,
      note: `${a.calendars.map(c => c.title).join(", ") || "календари ещё не прочитаны"} · встречи создаются только после вашего согласования`, problem: a.enabled ? loadProblem(a) : "подключение проверяется", disconnect: () => ui.removeCalDAVAccount(a.id) })),
    ...(projectCalendars.value?.connections ?? []).map(c => ({ key: `cal/${c.connection_id}`, title: `Календарь для проекта «${projectName(data.projects, c.project_id)}»`, note: lastLoad(c),
      problem: c.enabled ? loadProblem(c) : "отключено", disconnect: c.enabled ? () => ui.disableCalendarConnection(c.connection_id, c.revision) : undefined })),
  ];
  const enabled = (projectCalendars.value?.connections ?? []).filter(c => c.enabled);
  return <ConnectionRow title="Календарь" icon="calendar" what="События попадают в память; встречи агент назначает только после вашего согласования." loading={accounts.loading || projectCalendars.loading} error={accounts.error || projectCalendars.error} items={items} reload={reload}
    extra={enabled.length > 0 && <ReadGrants data={data} kind="calendar" connections={enabled.map(c => ({ id: c.connection_id, title: `Календарь для проекта «${projectName(data.projects, c.project_id)}»` }))} />}
    connect={done => <AccountForm what="календарь" done={done} services={accounts.value?.servers ?? []}
      onConnect={({ server, username, password }) => ui.connectCalDAVAccount({ request: crypto.randomUUID(), server, username, password })} />} />;
}

function DriveRow() {
  const ui = useUi();
  const accounts = useLoad(() => ui.listWebDAVAccounts(), FAILURE, [ui]);
  const items: Item[] = (accounts.value?.accounts ?? []).map(a => ({ key: `dav/${a.id}`, title: `${accounts.value?.servers.find(s => s.id === a.server)?.title ?? "Диск"} · ${a.username}`,
    note: `файлы копируются в память, на диске ничего не меняется · ${lastLoad(a)}`, problem: a.enabled ? loadProblem(a) : "подключение проверяется", disconnect: () => ui.removeWebDAVAccount(a.id) }));
  return <ConnectionRow title="Диск" icon="drive" what="Файлы с корпоративного диска копируются в память по вашему выбору." loading={accounts.loading} error={accounts.error} items={items} reload={accounts.reload}
    connect={done => <AccountForm what="диск" done={done} services={accounts.value?.servers ?? []}
      onConnect={({ server, username, password }) => ui.connectWebDAVAccount({ request: crypto.randomUUID(), server, username, password })} />} />;
}

const GIT_SERVICES = { github: { title: "GitHub", api: "https://api.github.com" }, gitlab: { title: "GitLab.com", api: "https://gitlab.com/api/v4" }, own: { title: "Свой сервер GitLab", api: "" } } as const;

function GitRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const connections = useLoad(() => ui.listGitConnections(""), FAILURE, [ui]);
  const items: Item[] = (connections.value?.connections ?? []).map(c => ({ key: `git/${c.connection_id}`, ...gitWords(c),
    problem: c.enabled ? loadProblem(c) : "отключено",
    disconnect: c.enabled ? () => ui.disableGitConnection(c.connection_id, c.revision) : undefined }));
  const enabled = (connections.value?.connections ?? []).filter(c => c.enabled);
  return <ConnectionRow title="Код" icon="code" connectLabel="Добавить GitHub" what="Внутреннее хранилище кода Mnemos, GitHub и GitLab. Проекту открывается выбранный репозиторий." loading={connections.loading} error={connections.error} items={items} reload={connections.reload}
    extra={<>
      {enabled.length > 0 && <GitBinding data={data} connections={enabled.map(c => ({ connection_id: c.connection_id, name: gitWords(c).title }))} />}
      <GitHubSync data={data} connections={enabled.filter(c => c.provider === "github").map(c => ({ connection_id: c.connection_id, name: gitWords(c).title }))} />
    </>}
    connect={done => <GitForm done={done} />} />;
}

const WHO_SEES: Record<string, string> = { private: "видите только вы", department: "видит отдел", organization: "видит вся организация" };
type SyncLink = Awaited<ReturnType<ReturnType<typeof useUi>["listGitSyncLinks"]>>["links"][number];

function syncState(l: SyncLink): { text: string; problem: boolean } {
  switch (l.state) {
    case "ok": return { text: "Работает", problem: false };
    case "pending": case "syncing": return { text: "Обновляется", problem: false };
    case "conflict": return { text: "Конфликт: файл изменён и в Mnemos, и в GitHub — разрешите в проекте", problem: true };
    case "disabled": return { text: "Отключено", problem: false };
    default: return { text: l.message || "Обновление не прошло", problem: true };
  }
}

const patterns = (text: string) => text.split(",").map(p => p.trim()).filter(Boolean);

/** «Синхронизация с GitHub»: репозиторий попадает в папку проекта и обновляется сам. */
function GitHubSync({ data, connections }: { data: MemoryData; connections: { connection_id: string; name: string }[] }) {
  const ui = useUi();
  const links = useLoad(() => ui.listGitSyncLinks(), "Связи с GitHub не прочитаны.", [ui]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function act(link: SyncLink, kind: "refresh" | "remove") {
    if (busy) return;
    setBusy(link.link_id); setNotice(null);
    try {
      if (kind === "refresh") { await ui.refreshGitSyncLink(link.link_id); setNotice({ tone: "success", text: `«${link.repository_name}» обновится в ближайшие минуты.` }); }
      else { await ui.deleteGitSyncLink(link.link_id, link.revision); setConfirm(""); setNotice({ tone: "success", text: `Синхронизация «${link.repository_name}» отключена. Файлы остались в проекте.` }); }
      await links.reload();
    } catch { setNotice({ tone: "danger", text: "Не получилось. Обновите страницу и проверьте права на проект." }); }
    finally { setBusy(""); }
  }
  const list = (links.value?.links ?? []).filter(l => l.state !== "disabled");
  return <section aria-label="Синхронизация с GitHub" className="rounded-2xl border border-kumo-fill p-4 text-[13px]">
    <h3 className="m-0 text-[14px] font-medium">Синхронизация с GitHub</h3>
    <p className="mt-1 mb-0 text-kumo-subtle">Файлы из GitHub сразу появляются в проекте опубликованными. Правка в Mnemos поверх такого файла даёт явный конфликт, ничего не теряется.</p>
    <div className="mt-2 grid gap-1.5">
      {links.loading && <Notice>Загрузка…</Notice>}
      {links.error && <Notice tone="danger">{links.error}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {list.map(l => {
        const state = syncState(l);
        const where = `проект «${projectName(data.projects, l.project_id)}», ${l.folder ? `папка «${l.folder}»` : "в корне проекта"}`;
        const when = l.last_synced_at ? `обновлено ${timeOf(l.last_synced_at)}` : "ещё не обновлялось";
        return <div key={l.link_id} data-sync-link="" className="flex flex-wrap items-center gap-2 rounded-xl bg-kumo-base px-3 py-2.5">
          <RowTitle title={`${l.repository_name} · ветка ${l.branch}`} note={<>{where} · {WHO_SEES[l.visibility] ?? "видимость как у проекта"} · {when}{state.problem && <span className="text-kumo-danger"> · {state.text}</span>}</>} />
          <StatusBadge tone={state.problem ? "danger" : "success"}>{state.problem ? "Требует внимания" : state.text}</StatusBadge>
          {l.can_manage && <Pill tone="ghost" disabled={!!busy} onClick={() => void act(l, "refresh")}>Обновить сейчас</Pill>}
          {l.can_manage && confirm !== l.link_id && <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm(l.link_id)}>Отключить</Pill>}
          {l.can_manage && confirm === l.link_id && <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-kumo-subtle">Отключить? Файлы останутся в проекте.</span>
            <Pill tone="primary" disabled={!!busy} onClick={() => void act(l, "remove")}>Да, отключить</Pill>
            <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("")}>Отмена</Pill>
          </span>}
        </div>;
      })}
      {!links.loading && !links.error && list.length === 0 && <p className="m-0 text-kumo-subtle">Репозитории GitHub ещё не связаны с проектами.</p>}
    </div>
    <div className="mt-3">
      {adding ? <GitHubSyncForm data={data} connections={connections} done={() => { setAdding(false); void links.reload(); }} cancel={() => setAdding(false)} />
        : <Pill onClick={() => setAdding(true)}>Связать репозиторий с проектом</Pill>}
    </div>
  </section>;
}

function GitHubSyncForm({ data, connections, done, cancel }: { data: MemoryData; connections: { connection_id: string; name: string }[]; done(): void; cancel(): void }) {
  const ui = useUi();
  const app = useLoad(() => ui.listGitAppRepositories(), "", [ui]);
  const appAvailable = app.value?.available === true;
  const [source, setSource] = useState("");
  const from = source || (appAvailable ? "app" : connections[0]?.connection_id ?? "");
  const personal = useLoad(async () => from && from !== "app" ? (await ui.listGitRepositories(from, 1)).repositories : [], "Список репозиториев не прочитан.", [ui, from]);
  const repos: { key: string; id: string; name: string; branch: string; installation: string }[] = from === "app"
    ? (app.value?.repositories ?? []).map(r => ({ key: `${r.installation_id}/${r.id}`, id: r.id, name: r.name, branch: r.default_branch, installation: r.installation_id }))
    : (personal.value ?? []).map(r => ({ key: r.id, id: r.id, name: r.name, branch: r.default_branch, installation: "" }));
  const [repoKey, setRepoKey] = useState("");
  const repo = repos.find(r => r.key === repoKey);
  const [branch, setBranch] = useState("");
  const [project, setProject] = useState("");
  const [folder, setFolder] = useState("");
  const [visibility, setVisibility] = useState<"private" | "department" | "organization">("private");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const branchName = branch.trim() || repo?.branch || "";
  async function submit() {
    if (busy || !repo || !project || !branchName) return;
    setBusy(true); setError("");
    try {
      await ui.createGitSyncLink({ project_id: project, source: from === "app" ? "app" : "connection", ...(from === "app" ? { installation_id: repo.installation } : { connection_id: from }),
        repository_id: repo.id, repository_name: repo.name, branch: branchName, folder: folder.trim().replace(/^\/+|\/+$/g, ""), include: patterns(include), exclude: patterns(exclude), visibility });
      done();
    } catch (e) { setError(e instanceof Error && /[а-яё]/i.test(e.message) ? e.message : "Связь не создана. Проверьте, что у вас есть право менять проект, и повторите."); }
    finally { setBusy(false); }
  }
  if (!app.loading && !appAvailable && connections.length === 0) return <Notice>Чтобы связать репозиторий, администратор сервера подключает приложение GitHub, либо вы добавляете ключ доступа GitHub выше.</Notice>;
  return <ActionForm aria-label="Связать репозиторий GitHub с проектом" onAction={() => void submit()} className="grid max-w-[480px] gap-3 text-[14px]">
    {(appAvailable ? 1 : 0) + connections.length > 1 && <Field label="Откуда брать код"><FieldSelect aria-label="Откуда брать код" value={from} disabled={busy} onChange={e => { setSource(e.target.value); setRepoKey(""); setBranch(""); }}>
      {appAvailable && <option value="app">Приложение GitHub организации</option>}
      {connections.map(c => <option key={c.connection_id} value={c.connection_id}>{c.name}</option>)}
    </FieldSelect></Field>}
    <Field label="Репозиторий"><FieldSelect aria-label="Репозиторий GitHub" value={repoKey} disabled={busy} onChange={e => { setRepoKey(e.target.value); setBranch(""); }}>
      <option value="">{app.loading || personal.loading ? "Загрузка…" : "Выберите репозиторий"}</option>
      {repos.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}
    </FieldSelect></Field>
    <Field label="Ветка"><FieldInput aria-label="Ветка" value={branch} disabled={busy} onChange={e => setBranch(e.target.value)} placeholder={repo?.branch || "main"} /></Field>
    <Field label="Проект"><FieldSelect aria-label="Проект для синхронизации" value={project} disabled={busy} onChange={e => setProject(e.target.value)}><option value="">Выберите проект</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FieldSelect></Field>
    <Field label="Папка в проекте (необязательно)"><FieldInput aria-label="Папка в проекте" value={folder} disabled={busy} onChange={e => setFolder(e.target.value)} placeholder="Например, Код/Сайт" /></Field>
    <Field label="Кто видит"><FieldSelect aria-label="Кто видит" value={visibility} disabled={busy} onChange={e => setVisibility(e.target.value as typeof visibility)}>
      <option value="private">Только я</option><option value="department">Отдел</option><option value="organization">Вся организация</option>
    </FieldSelect></Field>
    <Field label="Какие файлы брать (необязательно)"><FieldInput aria-label="Какие файлы брать" value={include} disabled={busy} onChange={e => setInclude(e.target.value)} placeholder="docs/**, *.md" /></Field>
    <Field label="Какие файлы пропускать (необязательно)"><FieldInput aria-label="Какие файлы пропускать" value={exclude} disabled={busy} onChange={e => setExclude(e.target.value)} placeholder="tests/**, *.lock" /></Field>
    <p className="m-0 text-[12px] text-kumo-subtle">«Кто видит» меняет видимость всего проекта. Двоичные файлы и файлы больше 1 МБ не переносятся.</p>
    {personal.error && <Notice tone="danger">{personal.error}</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
    <div className="flex flex-wrap gap-2">
      <Pill tone="primary" disabled={busy || !repo || !project || !branchName} onClick={() => void submit()}>{busy ? "Связываем…" : "Связать"}</Pill>
      <Pill tone="ghost" disabled={busy} onClick={cancel}>Отмена</Pill>
    </div>
  </ActionForm>;
}

/** Строка подключения кода словами. Внутреннее хранилище установки (provider "gitea") работает от
 * служебной учётной записи организации: ни название программы, ни эта учётная запись человеку ничего не говорят. */
export function gitWords(c: { provider: string; name: string; account_login: string }): { title: string; note: string } {
  const consent = "изменения агент отправляет только после вашего согласования";
  if (c.provider !== "github" && c.provider !== "gitlab") return { title: "Внутреннее хранилище кода Mnemos", note: consent };
  const service = c.provider === "github" ? "GitHub" : "GitLab";
  return { title: c.name || `Хранилище кода ${service}`, note: `${service}${c.account_login ? ` · учётная запись ${c.account_login}` : ""} · ${consent}` };
}

function GitForm({ done }: { done(): void }) {
  const ui = useUi();
  const [service, setService] = useState<keyof typeof GIT_SERVICES>("github");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const api = service === "own" ? address.trim().replace(/\/$/, "") + (address.trim() && !/\/api\/v4$/.test(address.trim().replace(/\/$/, "")) ? "/api/v4" : "") : GIT_SERVICES[service].api;
  async function submit() {
    if (busy || !name.trim() || !token || !api) return;
    setBusy(true); setError("");
    try {
      const intent = await ui.saveGitRegistrationIntent({ provider: service === "github" ? "github" : "gitlab", api_base: api, name: name.trim() });
      await ui.executeGitRegistrationIntent(intent.id, token, false);
      setToken(""); done();
    } catch { setToken(""); setError("Не подключилось. Проверьте ключ доступа и адрес сервера."); }
    finally { setBusy(false); }
  }
  return <ActionForm aria-label="Подключить код" onAction={() => void submit()} className="grid max-w-[480px] gap-3 text-[14px]">
    <Field label="Где хранится код"><FieldSelect aria-label="Хранилище кода" value={service} disabled={busy} onChange={e => setService(e.target.value as keyof typeof GIT_SERVICES)}>
      {Object.entries(GIT_SERVICES).map(([id, s]) => <option key={id} value={id}>{s.title}</option>)}
    </FieldSelect></Field>
    {service === "own" && <Field label="Адрес сервера GitLab"><FieldInput aria-label="Адрес сервера GitLab" value={address} disabled={busy} onChange={e => setAddress(e.target.value)} placeholder="https://gitlab.company.ru" /></Field>}
    <Field label="Название"><FieldInput aria-label="Название подключения" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Например, Код компании" /></Field>
    <Field label="Ключ доступа"><FieldInput aria-label="Ключ доступа" type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></Field>
    <p className="m-0 text-[12px] text-kumo-subtle">Ключ доступа создаётся в настройках GitHub или GitLab. Он хранится на сервере памяти и не передаётся агентам.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Pill tone="primary" disabled={busy || !name.trim() || !token || !api} onClick={() => void submit()}>{busy ? "Подключаем…" : "Подключить"}</Pill></div>
  </ActionForm>;
}

/** Открыть проекту репозиторий: проект и репозиторий выбираются по названиям. */
function GitBinding({ data, connections }: { data: MemoryData; connections: { connection_id: string; name: string }[] }) {
  const ui = useUi();
  const [connection, setConnection] = useState(connections[0].connection_id);
  const [project, setProject] = useState("");
  const [repository, setRepository] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const repositories = useLoad(async () => (await ui.listGitRepositories(connection, 1)).repositories, "Список репозиториев не прочитан.", [ui, connection]);
  async function bind() {
    const repo = repositories.value?.find(r => r.id === repository);
    if (busy || !project || !repo) return;
    setBusy(true); setNotice(null);
    try {
      const state = await ui.readOwnedGitBinding(project, connection, repo.id);
      await ui.bindGitRepository(project, connection, repo.id, { expected_connection_revision: state.connection_revision, expected_revision: state.binding?.revision ?? 0, repository_name: repo.name, enabled: true });
      setNotice({ tone: "success", text: `Репозиторий «${repo.name}» открыт проекту «${projectName(data.projects, project)}».` });
    } catch { setNotice({ tone: "danger", text: "Не получилось. Проверьте, что у вас есть право менять проект." }); }
    finally { setBusy(false); }
  }
  return <section aria-label="Код для проекта" className="rounded-2xl border border-kumo-fill p-4 text-[13px]">
    <h3 className="m-0 text-[14px] font-medium">Открыть проекту репозиторий</h3>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {connections.length > 1 && <PillSelect aria-label="Подключение кода" value={connection} disabled={busy} onChange={e => { setConnection(e.target.value); setRepository(""); }}>{connections.map(c => <option key={c.connection_id} value={c.connection_id}>{c.name}</option>)}</PillSelect>}
      <PillSelect aria-label="Репозиторий" value={repository} disabled={busy || !repositories.value} onChange={e => setRepository(e.target.value)}>
        <option value="">{repositories.loading ? "Загрузка…" : "Выберите репозиторий"}</option>
        {(repositories.value ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </PillSelect>
      <PillSelect aria-label="Проект для кода" value={project} disabled={busy} onChange={e => setProject(e.target.value)}>
        <option value="">Выберите проект</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </PillSelect>
      <Pill disabled={busy || !project || !repository} onClick={() => void bind()}>Открыть проекту</Pill>
    </div>
    {repositories.error && <Notice tone="danger">{repositories.error}</Notice>}
    {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
  </section>;
}

function DatabaseRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const databases = useLoad(() => ui.listVisibleDatabaseConnections(), FAILURE, [ui]);
  const items: Item[] = (databases.value?.databases ?? []).map(d => ({ key: `db/${d.db_id}`, title: d.name || "База данных",
    note: `проект «${projectName(data.projects, d.project_id)}» · агент только читает · ${d.configured ? "структура прочитана" : "ждёт ключа доступа от администратора сервера"}`,
    problem: d.unreachable_since ? `база недоступна с ${timeOf(d.unreachable_since)}` : "", disconnect: () => ui.removeDatabaseConnection(d.project_id, d.name) }));
  return <ConnectionRow title="Базы данных" icon="database" what="Агент читает данные из рабочих баз, но ничего в них не меняет." loading={databases.loading} error={databases.error} items={items} reload={databases.reload}
    connect={done => <DatabaseForm data={data} done={done} />} />;
}

function DatabaseForm({ data, done }: { data: MemoryData; done(): void }) {
  const ui = useUi();
  const [project, setProject] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyValid = /^MNEMOS_DB_[A-Z0-9_]+$/.test(key.trim());
  async function submit() {
    if (busy || !project || !name.trim() || !keyValid) return;
    setBusy(true); setError("");
    try { await ui.registerDatabaseConnection(project, { name: name.trim(), driver: "postgres", env_var: key.trim(), max_rows: 200, timeout_ms: 10000 }); done(); }
    catch { setError("Не подключилось. Проверьте название ключа и что у вас есть право менять проект."); }
    finally { setBusy(false); }
  }
  return <ActionForm aria-label="Подключить базу данных" onAction={() => void submit()} className="grid max-w-[480px] gap-3 text-[14px]">
    <Field label="Проект"><FieldSelect aria-label="Проект базы" value={project} disabled={busy} onChange={e => setProject(e.target.value)}><option value="">Выберите проект</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FieldSelect></Field>
    <Field label="Название базы"><FieldInput aria-label="Название базы" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Например, Продажи" /></Field>
    <Field label="Ключ, который выдал администратор сервера"><FieldInput aria-label="Ключ базы" value={key} disabled={busy} onChange={e => setKey(e.target.value.toUpperCase())} placeholder="MNEMOS_DB_SALES" /></Field>
    <p className="m-0 text-[12px] text-kumo-subtle">Пароль от базы вводит не сотрудник: администратор сервера сохраняет его и сообщает название ключа.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Pill tone="primary" disabled={busy || !project || !name.trim() || !keyValid} onClick={() => void submit()}>{busy ? "Подключаем…" : "Подключить"}</Pill></div>
  </ActionForm>;
}

function TelegramRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const bots = useLoad(() => ui.listTelegram(), FAILURE, [ui]);
  const agents = agentNames(data.connections);
  const items: Item[] = (bots.value?.connections ?? []).filter(c => !c.disconnected || c.cleanup_pending).map(c => ({ key: `tg/${c.bot}`, title: `Бот @${c.username}`,
    note: `отвечает ${agents.get(c.binding) ?? "ваш агент"}`, problem: c.channel_registered ? "" : c.ready ? "подтвердите подключение в чате с ботом" : "бот недоступен", disconnect: () => ui.disconnectTelegram(c.bot) }));
  return <ConnectionRow title="Telegram" icon="telegram" what="Задачи агенту можно ставить сообщением в Telegram; ответы приходят туда же." loading={bots.loading} error={bots.error} items={items} reload={bots.reload}
    connect={done => <TelegramForm data={data} done={done} />} />;
}

function TelegramForm({ data, done }: { data: MemoryData; done(): void }) {
  const ui = useUi();
  const managed = data.connections.filter(c => !c.revoked && c.managed_runtime === true);
  const names = agentNames(data.connections);
  const [token, setToken] = useState("");
  const [agent, setAgent] = useState(managed[0]?.binding_id ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState<{ bot: string; epoch: string; code: string | null; candidate: number | null; sender: number | null; channel_registered: boolean } | null>(null);
  async function connect() {
    if (busy || !token.trim() || !agent || !consent) return;
    setBusy(true); setError("");
    try { const out = await ui.connectTelegram(crypto.randomUUID(), token.trim(), agent, true); setToken(""); setState(out); }
    catch { setToken(""); setError("Бот не подключился. Проверьте токен от BotFather и повторите."); }
    finally { setBusy(false); }
  }
  async function check() {
    if (!state || busy) return;
    setBusy(true); setError("");
    try {
      let out = await ui.describeTelegram(state.bot);
      if (out.candidate !== null && out.sender === null) out = await ui.confirmTelegram(out.bot, out.epoch, out.candidate);
      setState(out);
      if (out.channel_registered) done();
    } catch { setError("Подтверждение не прошло. Отправьте боту команду ещё раз и повторите."); }
    finally { setBusy(false); }
  }
  if (!managed.length) return <Notice>Сначала нужен агент на платформе агентов: ему бот будет передавать сообщения.</Notice>;
  if (state && !state.channel_registered) return <div className="grid gap-2 text-[13px]">
    <p className="m-0">Откройте бота в Telegram и отправьте ему: <strong>/start {state.code}</strong></p>
    <div><Pill tone="primary" disabled={busy} onClick={() => void check()}>Я отправил — проверить</Pill></div>
    {error && <Notice tone="danger">{error}</Notice>}
  </div>;
  return <ActionForm aria-label="Подключить Telegram" onAction={() => void connect()} className="grid max-w-[480px] gap-3 text-[14px]">
    <Field label="Токен бота от BotFather"><FieldInput aria-label="Токен бота" type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></Field>
    <Field label="Кто отвечает в боте"><FieldSelect aria-label="Агент бота" value={agent} disabled={busy} onChange={e => setAgent(e.target.value)}>{managed.map(a => <option key={a.binding_id} value={a.binding_id}>{names.get(a.binding_id) ?? "Агент"}</option>)}</FieldSelect></Field>
    <label className="flex items-center gap-2"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Разрешаю агенту получать мои сообщения и отвечать через Telegram</label>
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Pill tone="primary" disabled={busy || !token.trim() || !agent || !consent} onClick={() => void connect()}>{busy ? "Подключаем…" : "Подключить"}</Pill></div>
  </ActionForm>;
}

type Grant = { connection_id: string; principal_id: string; connection_revision: number; revision: number; enabled: boolean };
/** Какие агенты читают письма или календарь проекта: переключатель на пару «подключение — агент», по именам.
 * Блок показывается только в раскрытой «Настроить» строке, поэтому разрешения читаются лишь тогда. */
function ReadGrants({ data, kind, connections }: { data: MemoryData; kind: "mail" | "calendar"; connections: { id: string; title: string }[] }) {
  const ui = useUi();
  const agents = data.connections.filter(a => !a.revoked);
  const names = agentNames(data.connections);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const read = (connection: string, principal: string): Promise<Grant> => kind === "mail" ? ui.readMailGrantState(connection, principal) : ui.readCalendarGrantState(connection, principal);
  const grants = useLoad(async () => {
    const out = new Map<string, Grant>();
    for (const c of connections) for (const a of agents) { const g = await read(c.id, a.agent_principal_id).catch(() => null); if (g) out.set(`${c.id}/${a.agent_principal_id}`, g); }
    return out;
  }, "Разрешения агентов не прочитаны.", [ui, connections.map(c => c.id).join(","), agents.map(a => a.agent_principal_id).join(",")]);
  async function change(grant: Grant, enabled: boolean) {
    const key = `${grant.connection_id}/${grant.principal_id}`;
    if (busy) return;
    setBusy(key); setError("");
    const input = { principal_id: grant.principal_id, connection_revision: grant.connection_revision, expected_revision: grant.revision, enabled };
    try { if (kind === "mail") await ui.setMailReadGrant(grant.connection_id, input); else await ui.setCalendarReadGrant(grant.connection_id, input); await grants.reload(); }
    catch { setError("Разрешение не изменилось. Обновите страницу и повторите."); }
    finally { setBusy(""); }
  }
  if (!agents.length) return null;
  return <section aria-label={kind === "mail" ? "Какие агенты читают письма" : "Какие агенты видят календарь"} className="rounded-2xl border border-kumo-fill p-4 text-[13px]">
    <h3 className="m-0 text-[14px] font-medium">{kind === "mail" ? "Какие агенты читают письма" : "Какие агенты видят календарь"}</h3>
    <div className="mt-2 grid gap-1.5">
      {grants.loading && <Notice>Загрузка…</Notice>}
      {connections.map(c => agents.map(a => {
        const grant = grants.value?.get(`${c.id}/${a.agent_principal_id}`);
        return grant ? <label key={`${c.id}/${a.binding_id}`} className="flex items-center gap-2">
          <input type="checkbox" checked={grant.enabled} disabled={!!busy} onChange={e => void change(grant, e.target.checked)} />
          {names.get(a.binding_id) ?? "Агент"} — {c.title}
        </label> : null;
      }))}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  </section>;
}
