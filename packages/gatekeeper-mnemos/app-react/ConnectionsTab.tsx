import { useEffect, useState, type ReactNode } from "react";
import { CalendarBlank, Code, Database, Envelope, Folder, TelegramLogo } from "@phosphor-icons/react";
import { useHost, useUi } from "./host.ts";
import { agentNames, projectName, useLoad, type MemoryData } from "./data.ts";
import { ActionForm, Notice, StatusBadge } from "./ui.tsx";
import { Field, FieldInput, FieldSelect, Pill, PillSelect, RowTitle } from "./admin-ui.tsx";
import GitHubRepositories, { repoFromApp, type RepoRow } from "./GitHubRepositories.tsx";

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
function ConnectionRow({ title, icon, what, loading, error, items, connect, connectLabel, reload, extra, openWhen }: { title: string; icon: keyof typeof ICONS; what: string; loading: boolean; error: string; items: Item[]; connect?: (done: () => void) => ReactNode; connectLabel?: string; reload(): Promise<void>; extra?: ReactNode; openWhen?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (openWhen) setOpen(true); }, [openWhen]);
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
  const githubReturn = useGitHubReturn();
  return <ConnectionRow title="Код" icon="code" connectLabel="Добавить GitHub" what="Внутреннее хранилище кода Mnemos, GitHub и GitLab. Проекту открывается выбранный репозиторий." loading={connections.loading} error={connections.error} items={items} reload={connections.reload}
    openWhen={githubReturn !== null}
    extra={<>
      {enabled.length > 0 && <GitBinding data={data} connections={enabled.map(c => ({ connection_id: c.connection_id, name: gitWords(c).title }))} />}
      <GitHubSync data={data} connections={enabled.filter(c => c.provider === "github").map(c => ({ connection_id: c.connection_id, name: gitWords(c).title }))} githubReturn={githubReturn} />
    </>}
    connect={done => <GitForm done={done} />} />;
}

type SyncLink = Awaited<ReturnType<ReturnType<typeof useUi>["listGitSyncLinks"]>>["links"][number];

/** Создать проект может тот, кому это разрешает правило «Кто создаёт проекты»; окончательно решает сервер. */
function canCreateProjects(identity: MemoryData["identity"]): boolean {
  return !!identity?.capabilities?.includes("project.create") || !!identity?.roles?.can_create_projects;
}

type GitHubReturn = { result: "connected" | "updated" | "failed"; reason: string };

/** Итог возврата с GitHub из адреса страницы: хост отдаёт его один раз. */
function useGitHubReturn(): GitHubReturn | null {
  const host = useHost();
  const [value, setValue] = useState<GitHubReturn | null>(null);
  useEffect(() => { host.takeGitHubReturn().then(r => { if (r) setValue(r); }, () => {}); }, [host]);
  return value;
}

const GITHUB_FAILURES: Record<string, string> = {
  state: "Ссылка подключения устарела или уже использована. Нажмите «Подключить GitHub» ещё раз.",
  denied: "GitHub не подтвердил вход. Нажмите «Подключить GitHub» и разрешите доступ приложению Mnemos.",
  unconfirmed: "GitHub не подтвердил, что этот аккаунт доступен вам. Войдите в GitHub под нужным аккаунтом и повторите.",
  none: "GitHub не показал ни одной установки приложения Mnemos, доступной вам. Если установку в организацию должен одобрить её администратор, дождитесь одобрения и нажмите «Подключить GitHub» ещё раз.",
  requested: "Запрос на установку приложения Mnemos отправлен администратору организации в GitHub. Когда он одобрит, нажмите «Подключить GitHub».",
  unconfigured: "GitHub-приложение не настроено до конца. Обратитесь к администратору сервера.",
};

function githubReturnNotice(r: GitHubReturn): { tone: "success" | "danger"; text: string } {
  if (r.result === "connected") return { tone: "success", text: "GitHub подключён. Его репозитории можно связывать с проектами." };
  if (r.result === "updated") return { tone: "success", text: "Доступ в GitHub изменён. Список репозиториев обновлён." };
  // Приложение поставлено прямо на GitHub, не по кнопке: чья установка, Mnemos узнает при подключении.
  if (r.reason === "installed") return { tone: "success", text: "Приложение Mnemos установлено в GitHub. Нажмите «Подключить GitHub», чтобы его репозитории стали доступны вам." };
  return { tone: "danger", text: GITHUB_FAILURES[r.reason] ?? "GitHub не ответил. Повторите через несколько минут." };
}

function repositoriesWord(n: number): string {
  const last = n % 10, tens = n % 100;
  if (last === 1 && tens !== 11) return `${n} выбранный репозиторий`;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return `${n} выбранных репозитория`;
  return `${n} выбранных репозиториев`;
}

type GitHubAccountPage = Awaited<ReturnType<ReturnType<typeof useUi>["listGitHubAccounts"]>>;
type GitHubAccountRow = GitHubAccountPage["accounts"][number];

function accountNote(a: GitHubAccountRow): string {
  const repos = a.repository_selection === "all" ? "все репозитории" : a.repository_count >= 0 ? repositoriesWord(a.repository_count) : "выбранные репозитории";
  const kind = a.account_type === "Organization" ? "организация · " : "";
  const via = a.github_login && a.github_login !== a.account_login ? ` · подключено через ${a.github_login}` : "";
  return `${kind}${repos}${via}`;
}

/** «Ваши аккаунты GitHub»: у каждого человека свои. GitHub открывается в новой вкладке: фрейму Mnemos
 * самому открывать окна нельзя, это делает хост и только для страниц приложения GitHub. */
function GitHubAccounts({ accounts, reload, changed }: { accounts: { value: GitHubAccountPage | null; error: string; loading: boolean }; reload(): Promise<void>; changed(): void }) {
  const ui = useUi();
  const host = useHost();
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const page = accounts.value;
  if (accounts.loading && !page) return <Notice>Загрузка аккаунтов GitHub…</Notice>;
  if (accounts.error) return <Notice tone="danger">{accounts.error}</Notice>;
  if (!page?.available) return null;
  async function open(url: string, what: string) {
    const opened = await host.openGitHubAppPage(url);
    if (opened) { setPending(""); setNotice({ tone: "success", text: `${what} открыт в новой вкладке. Когда закончите, вернитесь сюда — список обновится сам.` }); }
    else { setPending(url); setNotice({ tone: "danger", text: "Браузер не открыл новую вкладку. Нажмите «Открыть GitHub»." }); }
  }
  async function connect() {
    if (busy) return;
    setBusy("connect"); setNotice(null);
    try { const { url } = await ui.startGitHubConnect(); await open(url, "GitHub"); }
    catch { setNotice({ tone: "danger", text: "Не получилось начать подключение. Обновите страницу и повторите." }); }
    finally { setBusy(""); }
  }
  async function disconnect(a: GitHubAccountRow) {
    if (busy) return;
    setBusy(a.installation_id); setNotice(null);
    try { await ui.disconnectGitHubAccount(a.installation_id); setConfirm(""); setNotice({ tone: "success", text: `Аккаунт GitHub «${a.account_login}» отключён. Его связи остановлены, файлы остались в проектах.` }); await reload(); changed(); }
    catch { setNotice({ tone: "danger", text: "Отключение не подтверждено. Обновите страницу и проверьте ещё раз." }); }
    finally { setBusy(""); }
  }
  return <div aria-label="Ваши аккаунты GitHub" className="mt-3 grid gap-1.5">
    <h4 className="m-0 text-[13px] font-medium">Ваши аккаунты GitHub</h4>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {page.accounts.map(a => <div key={a.installation_id} data-github-account="" className="flex flex-wrap items-center gap-2 rounded-xl bg-kumo-base px-3 py-2.5">
      <RowTitle title={a.account_login} note={accountNote(a)} />
      {a.manage_url && <Pill tone="ghost" disabled={!!busy} onClick={() => void open(a.manage_url, "GitHub")}>Изменить доступ</Pill>}
      {confirm !== a.installation_id && <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm(a.installation_id)}>Отключить</Pill>}
      {confirm === a.installation_id && <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-kumo-subtle">Отключить? Связи с его репозиториями остановятся, файлы останутся в проектах.</span>
        <Pill tone="primary" disabled={!!busy} onClick={() => void disconnect(a)}>Да, отключить</Pill>
        <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("")}>Отмена</Pill>
      </span>}
    </div>)}
    {page.accounts.length === 0 && <p className="m-0 text-kumo-subtle">Вы ещё не подключили GitHub. Связать с проектом можно только репозитории своих аккаунтов.</p>}
    {page.connectable
      ? <div className="flex flex-wrap items-center gap-2">
        <Pill disabled={!!busy} onClick={() => void connect()}>{busy === "connect" ? "Открываем GitHub…" : page.accounts.length ? "Подключить ещё аккаунт GitHub" : "Подключить GitHub"}</Pill>
        {pending && <Pill tone="primary" onClick={() => void open(pending, "GitHub")}>Открыть GitHub</Pill>}
      </div>
      : <Notice>GitHub-приложение не настроено до конца: подключить свой GitHub пока нельзя. Обратитесь к администратору сервера.</Notice>}
    {page.connectable && <p className="m-0 text-[12px] text-kumo-subtle">GitHub спросит, под каким аккаунтом войти, и покажет, какие установки приложения Mnemos вам доступны. Если приложение ещё не установлено, GitHub предложит установить его и выбрать репозитории.</p>}
  </div>;
}

/** «Синхронизация с GitHub»: аккаунты, затем репозитории списком. Репозиторий становится новым проектом
 * или папкой существующего и дальше обновляется сам. */
function GitHubSync({ data, connections, githubReturn }: { data: MemoryData; connections: { connection_id: string; name: string }[]; githubReturn: GitHubReturn | null }) {
  const ui = useUi();
  const links = useLoad(() => ui.listGitSyncLinks(), "Связи с GitHub не прочитаны. Обновите страницу.", [ui]);
  const accounts = useLoad(() => ui.listGitHubAccounts(), "Аккаунты GitHub не прочитаны.", [ui]);
  const [version, setVersion] = useState(0);
  const personal = connections.map(c => c.connection_id).join(",");
  const repos = useLoad(async (): Promise<RepoRow[]> => {
    const app = await ui.listGitAppRepositories();
    const out = app.repositories.map(repoFromApp);
    // Личный ключ доступа GitHub — запасной вход: его репозитории в том же списке.
    for (const c of connections) {
      const page = await ui.listGitRepositories(c.connection_id, 1);
      for (const r of page.repositories) if (!out.some(o => o.id === r.id)) {
        const slash = r.name.indexOf("/");
        out.push({ key: `conn/${c.connection_id}/${r.id}`, id: r.id, name: r.name, short: slash >= 0 ? r.name.slice(slash + 1) : r.name, account: slash >= 0 ? r.name.slice(0, slash) : c.name,
          branch: r.default_branch, private: null, pushedAt: "", language: "", source: "connection", installation: "", connection: c.connection_id });
      }
    }
    return out;
  }, "Список репозиториев GitHub не прочитан. Обновите страницу.", [ui, personal, version]);
  // Подключение идёт в соседней вкладке: вернувшись, человек видит свежий список без обновления страницы.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") { void accounts.reload(); void links.reload(); setVersion(v => v + 1); } };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [accounts.reload, links.reload]);
  return <section aria-label="Синхронизация с GitHub" className="rounded-2xl border border-kumo-fill p-4 text-[13px]">
    <h3 className="m-0 text-[14px] font-medium">Синхронизация с GitHub</h3>
    <p className="mt-1 mb-0 text-kumo-subtle">Репозиторий становится проектом или папкой проекта и обновляется сам. Правка в Mnemos поверх файла из GitHub даёт явный конфликт, ничего не теряется.</p>
    {githubReturn && <div className="mt-2"><Notice tone={githubReturnNotice(githubReturn).tone}>{githubReturnNotice(githubReturn).text}</Notice></div>}
    <GitHubAccounts accounts={accounts} reload={accounts.reload} changed={() => { void links.reload(); setVersion(v => v + 1); }} />
    <GitHubRepositories data={data} repos={repos} links={links} canCreate={canCreateProjects(data.identity)} />
  </section>;
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
