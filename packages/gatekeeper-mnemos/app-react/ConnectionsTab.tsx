import { useState, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo";
import { useUi } from "./host.ts";
import { agentNames, projectName, useLoad, type MemoryData } from "./data.ts";
import { ActionForm, Notice, Row, RowList, RowText, Select, StatusBadge, TextInput } from "./ui.tsx";

const FAILURE = "не удалось прочитать подключения. Обновите страницу.";

function timeOf(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? "" : new Date(at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
const lastLoad = (a: { last_success_at?: string }) => a.last_success_at ? `последняя загрузка ${timeOf(a.last_success_at)}` : "материалов ещё не загружало";
const loadProblem = (a: { last_error_at?: string }) => a.last_error_at ? `последняя попытка чтения не удалась (${timeOf(a.last_error_at)})` : "";

/** Строка подключения: что это, работает ли, и «Отключить» с подтверждением на месте. */
interface Item { key: string; title: string; note: string; problem: string; disconnect?: () => Promise<unknown> }

/** «Подключения»: одна страница, строка на вид источника. Подключение настраивается прямо в строке,
 * без адресов серверов, служебных учётных записей и технических строк. */
export default function ConnectionsTab({ data }: { data: MemoryData }) {
  return <section aria-label="Подключения организации" className="grid gap-4">
    <MailRow data={data} />
    <CalendarRow data={data} />
    <DriveRow />
    <GitRow data={data} />
    <DatabaseRow data={data} />
    <TelegramRow data={data} />
  </section>;
}

/** Общая строка: заголовок, число, состояние словами, список подключений и форма «Подключить» раскрытием. */
function ConnectionRow({ title, what, loading, error, items, connect, reload, extra }: { title: string; what: string; loading: boolean; error: string; items: Item[]; connect?: (done: () => void) => ReactNode; reload(): Promise<void>; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const broken = items.filter(i => i.problem).length;
  const state = loading ? "Загрузка…" : error ? `Не удалось прочитать: ${error}` : items.length === 0 ? "Не подключено." : broken ? `Подключено: ${items.length}; требуют внимания: ${broken}.` : `Подключено: ${items.length}. Работает.`;
  async function disconnect(item: Item) {
    if (busy || !item.disconnect) return;
    setBusy(true); setNotice(null);
    try { await item.disconnect(); setNotice({ tone: "success", text: `«${item.title}» отключено.` }); setConfirm(""); await reload(); }
    catch { setNotice({ tone: "danger", text: "Отключение не подтверждено. Обновите страницу и проверьте ещё раз." }); }
    finally { setBusy(false); }
  }
  return <section aria-label={title} className="rounded-xl border border-kumo-line bg-kumo-base p-4">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-[15px] font-semibold text-kumo-strong">{title}</h2>
        <p className="mt-0.5 mb-0 text-[12px] text-kumo-subtle">{what}</p>
        <p className={`mt-1 mb-0 text-[13px] ${error || broken ? "text-kumo-danger" : "text-kumo-default"}`} role="status">{state}</p>
      </div>
      {connect && <Button variant={items.length ? "secondary" : "primary"} size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Свернуть" : "Подключить"}</Button>}
    </div>
    {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
    {items.length > 0 && <div className="mt-3"><RowList>{items.map(item => <Row key={item.key} className="items-start" data-connection="">
      <RowText title={item.title} note={item.problem ? <span className="text-kumo-danger">Не работает: {item.problem}</span> : item.note} />
      <StatusBadge tone={item.problem ? "danger" : "success"}>{item.problem ? "Требует внимания" : "Работает"}</StatusBadge>
      {item.disconnect && confirm !== item.key && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(item.key)}>Отключить</Button>}
      {item.disconnect && confirm === item.key && <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-kumo-subtle">Отключить?</span>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void disconnect(item)}>Да, отключить</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm("")}>Отмена</Button>
      </span>}
    </Row>)}</RowList></div>}
    {extra}
    {open && connect && <div className="mt-3 rounded-lg border border-kumo-line bg-kumo-elevated p-3">{connect(() => { setOpen(false); void reload(); })}</div>}
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
  return <ActionForm aria-label={`Подключить: ${what}`} onAction={() => void submit()} className="grid max-w-[480px] gap-3 text-[13px]">
    <label className="grid gap-1">Сервис<Select aria-label="Сервис" value={server} disabled={busy} onChange={e => setServer(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</Select></label>
    <label className="grid gap-1">Логин<TextInput aria-label="Логин" autoComplete="username" value={username} disabled={busy} onChange={e => setUsername(e.target.value)} placeholder="name@company.ru" /></label>
    <label className="grid gap-1">Пароль приложения<TextInput aria-label="Пароль приложения" type="password" autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
    <p className="m-0 text-[12px] text-kumo-subtle">Пароль приложения создаётся в настройках почты или календаря. Он хранится на сервере памяти и не передаётся агентам.</p>
    {extra && <label className="flex items-center gap-2"><input type="checkbox" checked={flag} disabled={busy} onChange={e => setFlag(e.target.checked)} />{extra}</label>}
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Button type="button" variant="primary" size="sm" disabled={busy || !server || !username.trim() || !password} onClick={() => void submit()}>{busy ? "Подключаем…" : "Подключить"}</Button></div>
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
  return <ConnectionRow title="Почта" what="Письма попадают в память; агент отвечает только после вашего согласования." loading={accounts.loading || projectMail.loading} error={accounts.error || projectMail.error} items={items} reload={reload}
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
  return <ConnectionRow title="Календарь" what="События попадают в память; встречи агент назначает только после вашего согласования." loading={accounts.loading || projectCalendars.loading} error={accounts.error || projectCalendars.error} items={items} reload={reload}
    extra={enabled.length > 0 && <ReadGrants data={data} kind="calendar" connections={enabled.map(c => ({ id: c.connection_id, title: `Календарь для проекта «${projectName(data.projects, c.project_id)}»` }))} />}
    connect={done => <AccountForm what="календарь" done={done} services={accounts.value?.servers ?? []}
      onConnect={({ server, username, password }) => ui.connectCalDAVAccount({ request: crypto.randomUUID(), server, username, password })} />} />;
}

function DriveRow() {
  const ui = useUi();
  const accounts = useLoad(() => ui.listWebDAVAccounts(), FAILURE, [ui]);
  const items: Item[] = (accounts.value?.accounts ?? []).map(a => ({ key: `dav/${a.id}`, title: `${accounts.value?.servers.find(s => s.id === a.server)?.title ?? "Диск"} · ${a.username}`,
    note: `файлы копируются в память, на диске ничего не меняется · ${lastLoad(a)}`, problem: a.enabled ? loadProblem(a) : "подключение проверяется", disconnect: () => ui.removeWebDAVAccount(a.id) }));
  return <ConnectionRow title="Диск" what="Файлы с корпоративного диска копируются в память по вашему выбору." loading={accounts.loading} error={accounts.error} items={items} reload={accounts.reload}
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
  return <>
    <ConnectionRow title="Код" what="Внутреннее хранилище кода Mnemos, GitHub и GitLab. Проекту открывается выбранный репозиторий." loading={connections.loading} error={connections.error} items={items} reload={connections.reload}
      connect={done => <GitForm done={done} />} />
    {enabled.length > 0 && <GitBinding data={data} connections={enabled.map(c => ({ connection_id: c.connection_id, name: gitWords(c).title }))} />}
  </>;
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
  return <ActionForm aria-label="Подключить код" onAction={() => void submit()} className="grid max-w-[480px] gap-3 text-[13px]">
    <label className="grid gap-1">Где хранится код<Select aria-label="Хранилище кода" value={service} disabled={busy} onChange={e => setService(e.target.value as keyof typeof GIT_SERVICES)}>
      {Object.entries(GIT_SERVICES).map(([id, s]) => <option key={id} value={id}>{s.title}</option>)}
    </Select></label>
    {service === "own" && <label className="grid gap-1">Адрес сервера GitLab<TextInput aria-label="Адрес сервера GitLab" value={address} disabled={busy} onChange={e => setAddress(e.target.value)} placeholder="https://gitlab.company.ru" /></label>}
    <label className="grid gap-1">Название<TextInput aria-label="Название подключения" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Например, Код компании" /></label>
    <label className="grid gap-1">Ключ доступа<TextInput aria-label="Ключ доступа" type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label>
    <p className="m-0 text-[12px] text-kumo-subtle">Ключ доступа создаётся в настройках GitHub или GitLab. Он хранится на сервере памяти и не передаётся агентам.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Button type="button" variant="primary" size="sm" disabled={busy || !name.trim() || !token || !api} onClick={() => void submit()}>{busy ? "Подключаем…" : "Подключить"}</Button></div>
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
  return <details aria-label="Код для проекта" className="rounded-xl border border-kumo-line bg-kumo-base p-4 text-[13px]">
    <summary className="cursor-pointer font-medium">Открыть проекту репозиторий</summary>
    <div className="mt-3 flex flex-wrap items-end gap-2">
      {connections.length > 1 && <Select aria-label="Подключение кода" value={connection} disabled={busy} onChange={e => { setConnection(e.target.value); setRepository(""); }}>{connections.map(c => <option key={c.connection_id} value={c.connection_id}>{c.name}</option>)}</Select>}
      <Select aria-label="Репозиторий" value={repository} disabled={busy || !repositories.value} onChange={e => setRepository(e.target.value)}>
        <option value="">{repositories.loading ? "Загрузка…" : "Выберите репозиторий"}</option>
        {(repositories.value ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
      <Select aria-label="Проект для кода" value={project} disabled={busy} onChange={e => setProject(e.target.value)}>
        <option value="">Выберите проект</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={busy || !project || !repository} onClick={() => void bind()}>Открыть проекту</Button>
    </div>
    {repositories.error && <Notice tone="danger">{repositories.error}</Notice>}
    {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
  </details>;
}

function DatabaseRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const databases = useLoad(() => ui.listVisibleDatabaseConnections(), FAILURE, [ui]);
  const items: Item[] = (databases.value?.databases ?? []).map(d => ({ key: `db/${d.db_id}`, title: d.name || "База данных",
    note: `проект «${projectName(data.projects, d.project_id)}» · агент только читает · ${d.configured ? "структура прочитана" : "ждёт ключа доступа от администратора сервера"}`,
    problem: d.unreachable_since ? `база недоступна с ${timeOf(d.unreachable_since)}` : "", disconnect: () => ui.removeDatabaseConnection(d.project_id, d.name) }));
  return <ConnectionRow title="Базы данных" what="Агент читает данные из рабочих баз, но ничего в них не меняет." loading={databases.loading} error={databases.error} items={items} reload={databases.reload}
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
  return <ActionForm aria-label="Подключить базу данных" onAction={() => void submit()} className="grid max-w-[480px] gap-3 text-[13px]">
    <label className="grid gap-1">Проект<Select aria-label="Проект базы" value={project} disabled={busy} onChange={e => setProject(e.target.value)}><option value="">Выберите проект</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
    <label className="grid gap-1">Название базы<TextInput aria-label="Название базы" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Например, Продажи" /></label>
    <label className="grid gap-1">Ключ, который выдал администратор сервера<TextInput aria-label="Ключ базы" value={key} disabled={busy} onChange={e => setKey(e.target.value.toUpperCase())} placeholder="MNEMOS_DB_SALES" /></label>
    <p className="m-0 text-[12px] text-kumo-subtle">Пароль от базы вводит не сотрудник: администратор сервера сохраняет его и сообщает название ключа.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Button type="button" variant="primary" size="sm" disabled={busy || !project || !name.trim() || !keyValid} onClick={() => void submit()}>{busy ? "Подключаем…" : "Подключить"}</Button></div>
  </ActionForm>;
}

function TelegramRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const bots = useLoad(() => ui.listTelegram(), FAILURE, [ui]);
  const agents = agentNames(data.connections);
  const items: Item[] = (bots.value?.connections ?? []).filter(c => !c.disconnected || c.cleanup_pending).map(c => ({ key: `tg/${c.bot}`, title: `Бот @${c.username}`,
    note: `отвечает ${agents.get(c.binding) ?? "ваш агент"}`, problem: c.channel_registered ? "" : c.ready ? "подтвердите подключение в чате с ботом" : "бот недоступен", disconnect: () => ui.disconnectTelegram(c.bot) }));
  return <ConnectionRow title="Telegram" what="Задачи агенту можно ставить сообщением в Telegram; ответы приходят туда же." loading={bots.loading} error={bots.error} items={items} reload={bots.reload}
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
    <div><Button size="sm" variant="primary" disabled={busy} onClick={() => void check()}>Я отправил — проверить</Button></div>
    {error && <Notice tone="danger">{error}</Notice>}
  </div>;
  return <ActionForm aria-label="Подключить Telegram" onAction={() => void connect()} className="grid max-w-[480px] gap-3 text-[13px]">
    <label className="grid gap-1">Токен бота от BotFather<TextInput aria-label="Токен бота" type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label>
    <label className="grid gap-1">Кто отвечает в боте<Select aria-label="Агент бота" value={agent} disabled={busy} onChange={e => setAgent(e.target.value)}>{managed.map(a => <option key={a.binding_id} value={a.binding_id}>{names.get(a.binding_id) ?? "Агент"}</option>)}</Select></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Разрешаю агенту получать мои сообщения и отвечать через Telegram</label>
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Button type="button" variant="primary" size="sm" disabled={busy || !token.trim() || !agent || !consent} onClick={() => void connect()}>{busy ? "Подключаем…" : "Подключить"}</Button></div>
  </ActionForm>;
}

type Grant = { connection_id: string; principal_id: string; connection_revision: number; revision: number; enabled: boolean };
/** Какие агенты читают письма или календарь проекта: переключатель на пару «подключение — агент», по именам. */
function ReadGrants({ data, kind, connections }: { data: MemoryData; kind: "mail" | "calendar"; connections: { id: string; title: string }[] }) {
  const ui = useUi();
  const agents = data.connections.filter(a => !a.revoked);
  const names = agentNames(data.connections);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const read = (connection: string, principal: string): Promise<Grant> => kind === "mail" ? ui.readMailGrantState(connection, principal) : ui.readCalendarGrantState(connection, principal);
  const grants = useLoad(async () => {
    if (!opened) return new Map<string, Grant>();
    const out = new Map<string, Grant>();
    for (const c of connections) for (const a of agents) { const g = await read(c.id, a.agent_principal_id).catch(() => null); if (g) out.set(`${c.id}/${a.agent_principal_id}`, g); }
    return out;
  }, "Разрешения агентов не прочитаны.", [ui, opened, connections.map(c => c.id).join(","), agents.map(a => a.agent_principal_id).join(",")]);
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
  return <details className="mt-3 text-[13px]" onToggle={e => setOpened((e.currentTarget as HTMLDetailsElement).open)}>
    <summary className="cursor-pointer text-kumo-subtle">{kind === "mail" ? "Какие агенты читают письма" : "Какие агенты видят календарь"}</summary>
    <div className="mt-2 grid gap-1">
      {grants.loading && opened && <Notice>Загрузка…</Notice>}
      {connections.map(c => agents.map(a => {
        const grant = grants.value?.get(`${c.id}/${a.agent_principal_id}`);
        return grant ? <label key={`${c.id}/${a.binding_id}`} className="flex items-center gap-2">
          <input type="checkbox" checked={grant.enabled} disabled={!!busy} onChange={e => void change(grant, e.target.checked)} />
          {names.get(a.binding_id) ?? "Агент"} — {c.title}
        </label> : null;
      }))}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  </details>;
}
