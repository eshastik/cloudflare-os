import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, CaretDown, Check, Code, GithubLogo, GlobeSimple, HardDrives, Key, LockSimple, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import type { GitAppRepository } from "../src/mnemos-api.ts";
import type { GitConnection } from "../src/git-connections.ts";
import { REPOSITORY_FAILURES, type RepositoryInput, type RepositoryOverview, type RepositoryRecord, type RepositoryVisibility } from "../src/git-repositories.ts";
import { useHost, useUi } from "./host.ts";
import { projectName, useLoad, type MemoryData, type ProjectData } from "./data.ts";
import { ActionForm, Notice } from "./ui.tsx";
import { Pill, plural } from "./admin-ui.tsx";
import { relativeTime } from "./time.ts";
import { GitHubAccounts, canCreateProjects, githubReturnNotice, useGitHubReturn, type GitHubReturn } from "./ConnectionsTab.tsx";

// Раздел «Репозитории» (решение владельца 25.09.2026). Репозиторий в проекте — одна запись с двумя
// возможностями: «Файлы в проекте» и «Агенты кода». Ни одного выпадающего списка, ни одного «Применить»:
// переключатели сохраняются сразу, выбор — поиском, чипами и строками.

type Tone = "ok" | "busy" | "attention";
const DOT: Record<Tone, string> = { ok: "bg-kumo-brand", busy: "bg-kumo-inactive", attention: "bg-kumo-warning" };
const VISIBILITY: { id: RepositoryVisibility; label: string }[] = [
  { id: "private", label: "Только я" },
  { id: "department", label: "Мой отдел" },
  { id: "organization", label: "Вся организация" },
];
const TAKE_HINTS = ["docs/**", "src/**", "*.md"];
const SKIP_HINTS = ["tests/**", "*.lock", "node_modules/**", "dist/**"];
const SEARCH_FROM = 6;

/** Возврат с GitHub приходит на «Подключения»; строка раздела переносит его сюда. */
let carriedReturn: GitHubReturn | null = null;

/** Репозиторий строкой: откуда он виден человеку и в каких проектах уже есть. */
interface RepoRow {
  key: string;
  name: string;
  short: string;
  account: string;
  source: "github_app" | "key" | "internal";
  provider: string;
  sourceTitle: string;
  private: boolean | null;
  language: string;
  pushedAt: string;
  branch: string;
  /** Как добавить в проект: вход через приложение или ключ; пусто — репозиторий виден только записями. */
  entry: { source: "app" | "connection"; installation?: string; connection?: string; id: string } | null;
  records: RepositoryRecord[];
}

function split(name: string, fallback = ""): { short: string; account: string } {
  const slash = name.indexOf("/");
  return slash >= 0 ? { account: name.slice(0, slash), short: name.slice(slash + 1) } : { account: fallback, short: name };
}

function identity(provider: string, connection: string, repository: string): string {
  // Номер репозитория GitHub неизменен во всём GitHub; у GitLab и внутреннего хранилища — только на своём сервере.
  return provider === "github" ? `github/${repository}` : `${provider}/${connection}/${repository}`;
}

const SOURCE_TITLE: Record<RepoRow["source"], string> = { github_app: "GitHub", key: "ключ доступа", internal: "внутреннее хранилище Mnemos" };

function attention(r: RepositoryRecord): boolean {
  const l = r.link;
  return !!r.agents_access_revoked || (!!l && (!!l.access_revoked || (!l.paused && (l.state === "error" || l.state === "blocked" || l.state === "conflict"))));
}

function sourcesCount(accounts: number, keys: number, internal: boolean): number {
  return accounts + keys + (internal ? 1 : 0);
}

/** Строка «Репозитории» на странице «Подключения»: единый счёт и переход в раздел. */
export function RepositoriesRow({ data }: { data: MemoryData }) {
  const ui = useUi();
  const host = useHost();
  const overview = useLoad(() => ui.listRepositoryOverview(), "не удалось прочитать репозитории", [ui]);
  const accounts = useLoad(() => ui.listGitHubAccounts(), "", [ui]);
  const keys = useLoad(async () => (await ui.listGitConnections("")).connections.filter(personalKey), "", [ui]);
  const returned = useGitHubReturn();
  useEffect(() => {
    if (!returned) return;
    carriedReturn = returned;
    void host.selectView("repositories").catch(() => {});
  }, [returned, host]);
  const v = overview.value;
  const sources = sourcesCount(accounts.value?.accounts.length ?? 0, keys.value?.length ?? 0, !!v?.internal.available);
  const inProjects = v?.records.length ?? 0;
  const broken = (v?.records.filter(attention).length ?? 0) + (accounts.value?.accounts.filter(a => a.access_stale).length ?? 0);
  const state = overview.loading ? "Загрузка…" : overview.error ? `Не удалось прочитать: ${overview.error}` : summaryText(sources, inProjects, broken);
  return <section aria-label="Репозитории" className="border-t border-kumo-fill first:border-t-0">
    <div className="flex items-center gap-3.5 px-5 py-4">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-kumo-tint text-kumo-default"><Code size={18} /></span>
      <span className="block min-w-0 flex-1">
        <h2 className="m-0 text-[15px] font-medium text-kumo-default">Репозитории</h2>
        <p role="status" className={`m-0 text-[13px] ${overview.error ? "text-kumo-danger" : broken ? "text-kumo-warning" : "text-kumo-subtle"}`}>{state}</p>
      </span>
      <Pill tone={inProjects || sources ? "secondary" : "primary"} onClick={() => void host.selectView("repositories").catch(() => {})}>{inProjects || sources ? "Открыть" : "Подключить"}</Pill>
    </div>
    {data.projects.length === 0 && !overview.loading && !inProjects && <p className="m-0 px-5 pb-4 text-[13px] text-kumo-subtle sm:pl-[70px]">Код из GitHub, GitLab и внутреннего хранилища Mnemos: файлы в проекте и агенты, которые правят код.</p>}
  </section>;
}

function summaryText(sources: number, inProjects: number, broken: number): string {
  if (!sources && !inProjects) return "Не подключено. Код из GitHub, GitLab и внутреннего хранилища Mnemos.";
  return `Источников: ${sources} · репозиториев в проектах: ${inProjects}${broken ? ` · требуют внимания: ${broken}` : ""}`;
}

/** Личный ключ доступа: GitHub или GitLab, не установка приложения и не внутреннее хранилище. */
function personalKey(c: GitConnection): boolean {
  return c.enabled && !c.installation_id && (c.provider === "github" || c.provider === "gitlab");
}

type Filter = "all" | "linked" | "attention";

/** Раздел целиком. */
export default function RepositoriesPage({ data, onBack }: { data: MemoryData; onBack(): void }) {
  const ui = useUi();
  const [version, setVersion] = useState(0);
  const overview = useLoad(() => ui.listRepositoryOverview(), "Репозитории не прочитаны. Обновите страницу.", [ui, version]);
  const accounts = useLoad(() => ui.listGitHubAccounts(), "Аккаунты GitHub не прочитаны.", [ui, version]);
  const appRepos = useLoad(async () => { const page = await ui.listGitAppRepositories(); return page.available ? page.repositories : []; }, "Список репозиториев GitHub не прочитан.", [ui, version]);
  const keys = useLoad(async () => (await ui.listGitConnections("")).connections.filter(personalKey), "Ключи доступа не прочитаны.", [ui, version]);
  const keyIds = (keys.value ?? []).map(k => k.connection_id).join(",");
  const keyRepos = useLoad(async () => {
    const out: { key: GitConnection; repos: { id: string; name: string; default_branch: string; public?: boolean }[] }[] = [];
    for (const key of keys.value ?? []) out.push({ key, repos: (await ui.listGitRepositories(key.connection_id, 1).catch(() => ({ repositories: [] }))).repositories });
    return out;
  }, "", [ui, keyIds]);
  const [returned] = useState<GitHubReturn | null>(() => { const r = carriedReturn; carriedReturn = null; return r; });
  const reload = () => setVersion(v => v + 1);
  // Подключение идёт в соседней вкладке GitHub: вернувшись, человек видит свежий список.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);
  // Пока файлы загружаются, состояние перечитывается само.
  const syncing = (overview.value?.records ?? []).some(r => r.link && !r.link.paused && (r.link.state === "pending" || r.link.state === "syncing"));
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => void overview.reload(), 5000);
    return () => clearInterval(timer);
  }, [syncing, overview.reload]);

  const rows = useMemo(() => buildRows(overview.value, appRepos.value ?? [], keyRepos.value ?? []), [overview.value, appRepos.value, keyRepos.value]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(r => (filter === "all" || (filter === "linked" ? r.records.length > 0 : r.records.some(attention)))
    && (!needle || r.name.toLowerCase().includes(needle) || r.language.toLowerCase().includes(needle) || r.records.some(x => projectName(data.projects, x.project_id).toLowerCase().includes(needle))));

  const v = overview.value;
  const staleAccounts = accounts.value?.accounts.filter(a => a.access_stale).length ?? 0;
  const counts = { sources: sourcesCount(accounts.value?.accounts.length ?? 0, keys.value?.length ?? 0, !!v?.internal.available), linked: v?.records.length ?? 0, attention: (v?.records.filter(attention).length ?? 0) + staleAccounts };
  const loading = overview.loading && !v;

  return <div className="max-w-[860px]">
    <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[14px] text-kumo-brand hover:underline focus-visible:outline-2 focus-visible:outline-kumo-ring">
      <ArrowLeft size={14} aria-hidden="true" />Подключения
    </button>
    <header className="mb-6">
      <h1 className="m-0 text-[30px] leading-[36px] font-semibold tracking-[-0.8px] text-kumo-default">Репозитории</h1>
      <p className="mt-1.5 mb-0 max-w-[640px] text-[15px] leading-[22px] text-kumo-subtle">Код в проектах: файлы, которые видят участники проекта, и агенты кода, которые работают в своих ветках. В основную ветку их работа попадает после «Принять».</p>
      <Ledger counts={counts} filter={filter} onFilter={setFilter} />
    </header>
    {returned && <div className="mb-4"><Notice tone={githubReturnNotice(returned).tone}>{githubReturnNotice(returned).text}</Notice></div>}

    <Sources overview={v} accounts={accounts} keys={keys.value ?? []} records={v?.records ?? []} onChanged={reload} />

    <section aria-label="Репозитории в проектах" className="mt-9">
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <h2 className="m-0 flex-1 text-[17px] font-semibold text-kumo-default">Репозитории</h2>
        {rows.length >= SEARCH_FROM && <label className="flex h-8 w-full items-center gap-2 rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 sm:w-[240px]">
          <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
          <input aria-label="Найти репозиторий" value={query} onChange={e => setQuery(e.target.value)} placeholder="Имя, язык или проект" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-kumo-default outline-none placeholder:text-kumo-inactive" />
        </label>}
      </div>
      {loading && <Notice>Загрузка репозиториев…</Notice>}
      {overview.error && <Notice tone="danger">{overview.error}</Notice>}
      {appRepos.error && <Notice tone="danger">{appRepos.error}</Notice>}
      {!loading && !overview.error && rows.length === 0 && <p className="m-0 rounded-2xl border border-dashed border-kumo-fill-hover px-5 py-6 text-[14px] text-kumo-subtle">Репозиториев пока нет. Подключите GitHub выше — его репозитории появятся здесь, и любой из них можно сделать проектом или добавить в проект.</p>}
      {shown.length > 0 && <ul aria-label="Репозитории" className="m-0 list-none overflow-hidden rounded-2xl border border-kumo-fill bg-kumo-overlay p-0">
        {shown.map(r => <Repository key={r.key} row={r} data={data} overview={v} onChanged={() => void overview.reload()} />)}
      </ul>}
      {rows.length > 0 && shown.length === 0 && <p className="m-0 text-[13px] text-kumo-subtle">{needle ? `Ничего не нашлось по «${query.trim()}».` : filter === "attention" ? "Всё работает: ничего не требует внимания." : "Ни один репозиторий ещё не добавлен в проект."}</p>}
    </section>
  </div>;
}

/** Единый счёт раздела. «Требуют внимания» — фильтр списка, а не отдельная страница. */
function Ledger({ counts, filter, onFilter }: { counts: { sources: number; linked: number; attention: number }; filter: Filter; onFilter(f: Filter): void }) {
  // Счёт источников — просто число; «в проектах» и «требуют внимания» ещё и сужают список, повторное нажатие снимает.
  const chip = (id: Filter, label: ReactNode, tone = "") => <button type="button" role="checkbox" aria-checked={filter === id} onClick={() => onFilter(filter === id ? "all" : id)}
    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-kumo-ring ${filter === id ? "border-kumo-brand bg-kumo-tint text-kumo-brand" : `border-kumo-fill-hover bg-kumo-overlay hover:bg-kumo-tint ${tone || "text-kumo-default"}`}`}>{label}</button>;
  return <div role="group" aria-label="Счёт и отбор" data-ledger="" className="mt-4 flex flex-wrap items-center gap-1.5">
    <span className="inline-flex h-8 items-center gap-1.5 px-1 text-[13px] text-kumo-subtle">Источников: <strong className="font-semibold text-kumo-default">{counts.sources}</strong><span aria-hidden="true">·</span></span>
    {chip("linked", <>репозиториев в проектах: <strong className="font-semibold">{counts.linked}</strong></>)}
    {counts.attention > 0 && chip("attention", <><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-kumo-warning" />требуют внимания: <strong className="font-semibold">{counts.attention}</strong></>, "text-kumo-warning")}
  </div>;
}

function buildRows(overview: RepositoryOverview | null, app: GitAppRepository[], keyed: { key: GitConnection; repos: { id: string; name: string; default_branch: string; public?: boolean }[] }[]): RepoRow[] {
  const rows = new Map<string, RepoRow>();
  const ensure = (key: string, init: () => RepoRow) => { let r = rows.get(key); if (!r) { r = init(); rows.set(key, r); } return r; };
  for (const a of app) {
    const { short, account } = split(a.name, a.account ?? "");
    const row = ensure(identity("github", "", a.id), () => ({ key: identity("github", "", a.id), name: a.name, short, account: a.account || account, source: "github_app", provider: "github", sourceTitle: "GitHub",
      private: a.private, language: a.language ?? "", pushedAt: a.pushed_at ?? "", branch: a.default_branch, entry: null, records: [] }));
    row.entry ??= { source: "app", installation: a.installation_id, id: a.id };
  }
  for (const { key, repos } of keyed) for (const r of repos) {
    const k = identity(key.provider, key.connection_id, r.id);
    const { short, account } = split(r.name, key.account_login);
    const row = ensure(k, () => ({ key: k, name: r.name, short, account, source: "key", provider: key.provider, sourceTitle: key.provider === "gitlab" ? "GitLab" : "GitHub, ключ доступа",
      // Приватность по ответу провайдера; ответа нет — приватный, как считает и сервер.
      private: r.public !== true, language: "", pushedAt: "", branch: r.default_branch, entry: null, records: [] }));
    // Приложение GitHub — основной вход; ключ — запасной, если приложения для репозитория нет.
    row.entry ??= { source: "connection", connection: key.connection_id, id: r.id };
  }
  for (const rec of overview?.records ?? []) {
    const k = identity(rec.provider, rec.connection_id, rec.repository_id);
    const { short, account } = split(rec.repository_name, rec.source_name);
    const row = ensure(k, () => ({ key: k, name: rec.repository_name, short, account, source: rec.source, provider: rec.provider,
      sourceTitle: rec.source === "internal" ? "внутреннее хранилище Mnemos" : rec.source === "github_app" ? "GitHub" : rec.provider === "gitlab" ? "GitLab" : "GitHub, ключ доступа",
      private: rec.source === "internal" ? null : rec.private, language: "", pushedAt: "", branch: rec.branch, entry: null, records: [] }));
    row.records.push(rec);
  }
  const linked = (r: RepoRow) => r.records.length > 0 ? 1 : 0;
  return [...rows.values()].sort((a, b) => Number(b.records.some(attention)) - Number(a.records.some(attention)) || linked(b) - linked(a) || (Date.parse(b.pushedAt) || 0) - (Date.parse(a.pushedAt) || 0) || a.name.localeCompare(b.name));
}

function repoMeta(r: RepoRow): string {
  return [r.sourceTitle, r.private === null ? "" : r.private ? "приватный" : "публичный", r.language, r.pushedAt ? `изменён ${relativeTime(r.pushedAt)}` : ""].filter(Boolean).join(" · ");
}

/** Строка репозитория: имя и метаданные, записи в проектах и действия. */
function Repository({ row, data, overview, onChanged }: { row: RepoRow; data: MemoryData; overview: RepositoryOverview | null; onChanged(): void }) {
  const [open, setOpen] = useState<"create" | "add" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const canCreate = canCreateProjects(data.identity);
  const taken = row.records.map(r => r.project_id);
  return <li data-repo={row.name} className="border-t border-kumo-fill first:border-t-0">
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-3.5 pb-3 sm:px-5">
      <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-kumo-tint text-kumo-default">
        {row.source === "internal" ? <HardDrives size={16} /> : row.private === false ? <GlobeSimple size={16} /> : <LockSimple size={16} />}
      </span>
      <span className="block min-w-[180px] flex-1">
        <span className="block text-[15px] font-medium break-words text-kumo-default">{row.short}{row.account && <span className="font-normal text-kumo-subtle"> · {row.account}</span>}</span>
        <span className="block text-[13px] text-kumo-subtle">{repoMeta(row)}</span>
      </span>
      {row.entry && <span className="flex flex-wrap items-center gap-1.5">
        {canCreate && row.records.length === 0 && <Pill tone={open === "create" ? "secondary" : "primary"} aria-expanded={open === "create"} onClick={() => { setNotice(null); setOpen(open === "create" ? null : "create"); }}>Создать проект</Pill>}
        <Pill tone={canCreate && !row.records.length ? "ghost" : "secondary"} aria-expanded={open === "add"} onClick={() => { setNotice(null); setOpen(open === "add" ? null : "add"); }}>{row.records.length ? "Добавить ещё в проект…" : "Добавить в проект…"}</Pill>
      </span>}
    </div>
    {notice && <div className="px-4 pb-3 sm:pl-[60px]"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
    {row.records.map(rec => <ProjectRecord key={`${rec.project_id}/${rec.connection_id}`} rec={rec} data={data} onChanged={onChanged} />)}
    {open && row.entry && <AddRepository key={open} mode={open} row={row} data={data} admin={!!overview?.admin} taken={taken}
      onCancel={() => setOpen(null)}
      onDone={async (text, project) => { setOpen(null); setNotice({ tone: "success", text }); onChanged(); if (project) await data.reloadProjects(); }} />}
  </li>;
}

/** Переключатель: сохраняется сразу. */
function Switch({ label, checked, disabled, busy, onChange }: { label: string; checked: boolean; disabled?: boolean; busy?: boolean; onChange(next: boolean): void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-busy={busy || undefined} disabled={disabled || busy} onClick={() => onChange(!checked)}
    className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border-0 p-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-ring disabled:cursor-not-allowed ${checked ? "bg-kumo-brand" : "bg-kumo-interact"} ${disabled ? "opacity-50" : ""}`}>
    <span aria-hidden="true" className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(24,32,28,0.25)] transition-[left] motion-reduce:transition-none ${checked ? "left-[18px]" : "left-[2px]"}`} />
  </button>;
}

function Capability({ title, checked, disabled, busy, status, tone, onChange, children }: { title: string; checked: boolean; disabled?: boolean; busy?: boolean; status: ReactNode; tone: Tone; onChange(next: boolean): void; children?: ReactNode }) {
  return <div data-capability={title} className="flex items-start gap-3">
    <span className="pt-0.5"><Switch label={title} checked={checked} disabled={disabled} busy={busy} onChange={onChange} /></span>
    <span className="block min-w-0 flex-1">
      <span className="block text-[14px] font-medium text-kumo-default">{title}</span>
      <span className={`flex items-start gap-1.5 text-[13px] ${tone === "attention" ? "text-kumo-warning" : "text-kumo-subtle"}`}>
        <span aria-hidden="true" className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${checked ? DOT[tone] : "bg-kumo-fill-hover"}`} />
        <span className="min-w-0">{status}</span>
      </span>
      {children}
    </span>
  </div>;
}

function filesWord(n: number): string { return `${n} ${plural(n, "файл", "файла", "файлов")}`; }

/** «Файлы: …» словами. */
function filesStatus(rec: RepositoryRecord, now = Date.now()): { text: string; tone: Tone } {
  const l = rec.link;
  if (rec.provider !== "github") return { text: "переносятся только из GitHub; код этого репозитория открыт на странице проекта", tone: "ok" };
  if (!l) return { text: "выключены — файлы репозитория не переносятся в проект", tone: "ok" };
  if (l.remove_requested) return { text: "файлы убираются из проекта", tone: "busy" };
  if (l.paused) return { text: `выключены — ${filesWord(l.file_count ?? 0)} остались в проекте и не обновляются`, tone: "ok" };
  const count = filesWord(l.file_count ?? 0);
  switch (l.state) {
    case "ok": return { text: `синхронизировано ${l.last_synced_at ? relativeTime(l.last_synced_at, now) : "только что"} · ${count}`, tone: "ok" };
    case "pending": case "syncing": return { text: (l.file_count ?? 0) > 0 ? `идёт синхронизация · уже ${count}` : l.last_synced_at ? "идёт синхронизация" : "идёт первая загрузка", tone: "busy" };
    case "conflict": return { text: "конфликт: файл изменён и в Mnemos, и в GitHub — выберите версию в проекте", tone: "attention" };
    default: return { text: l.message || "обновление не прошло — нажмите «Обновить сейчас»", tone: "attention" };
  }
}

function skippedSummary(rec: RepositoryRecord): { total: number; text: string } {
  const list = rec.link?.skipped ?? [];
  const binary = list.filter(s => s.reason === "binary").length, large = list.filter(s => s.reason === "large").length;
  const parts = [binary ? `двоичные ${binary}` : "", large ? `>1 МБ ${large}` : ""].filter(Boolean).join(", ");
  return { total: list.length, text: `пропущено ${list.length}${list.length >= 200 ? "+" : ""}${parts ? ` (${parts})` : ""}` };
}

/** Запись «репозиторий ↔ проект»: проект, две возможности и действия. Линия слева связывает их с проектом. */
function ProjectRecord({ rec: initial, data, onChanged }: { rec: RepositoryRecord; data: MemoryData; onChanged(): void }) {
  const ui = useUi();
  const host = useHost();
  const [rec, setRec] = useState(initial);
  useEffect(() => setRec(initial), [initial]);
  const [busy, setBusy] = useState<"" | "files" | "agents" | "refresh" | "detach" | "keep" | "remove">("");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState<{ change: "files" | "agents"; next: boolean } | null>(null);
  const [confirm, setConfirm] = useState<"" | "detach" | "remove">("");
  const [showSkipped, setShowSkipped] = useState(false);
  const [done, setDone] = useState("");
  const project = data.projects.find(p => p.id === rec.project_id);
  const waiting = useLoad(async () => {
    if (!rec.agents) return 0;
    const page = await ui.listGitBranches(rec.project_id, rec.connection_id, rec.repository_id, 1);
    return page.branches.filter(b => b.name.startsWith("agents/")).length;
  }, "", [ui, rec.project_id, rec.connection_id, rec.repository_id, rec.agents]);

  async function change(which: "files" | "agents", next: boolean, withConsent = false) {
    if (busy) return;
    setBusy(which); setError(""); setDone("");
    const before = rec;
    setRec({ ...rec, [which]: next });
    try {
      const out = await ui.setRepositoryCapabilities(rec.project_id, rec.connection_id, rec.repository_id, { expected_revision: rec.revision, [which]: next, ...(withConsent ? { consent: true } : {}) });
      setRec(out); setConsent(null); onChanged();
    } catch (e) {
      setRec(before);
      const message = e instanceof Error ? e.message : "";
      if (message === REPOSITORY_FAILURES["project.private_code_consent"]) setConsent({ change: which, next });
      else setError(/[а-яё]/i.test(message) ? message : "Не сохранилось. Обновите страницу и проверьте, что вы владелец проекта.");
    } finally { setBusy(""); }
  }
  async function act(kind: "refresh" | "detach" | "keep" | "remove") {
    if (busy) return;
    setBusy(kind); setError(""); setDone("");
    try {
      if (kind === "refresh" && rec.link) { await ui.refreshGitSyncLink(rec.link.link_id); setDone("Обновится в ближайшие минуты."); }
      if (kind === "detach") { await ui.detachRepository(rec.project_id, rec.connection_id, rec.repository_id, rec.revision); setConfirm(""); onChanged(); return; }
      if ((kind === "keep" || kind === "remove") && rec.link) { await ui.resolveRevokedRepository(rec.link.link_id, kind === "remove"); setConfirm(""); setDone(kind === "keep" ? "Файлы остались в проекте обычными документами." : "Файлы убираются из проекта; правленые в Mnemos останутся."); onChanged(); }
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(/[а-яё]/i.test(message) ? message : "Не получилось. Обновите страницу и проверьте, что вы владелец проекта.");
    } finally { setBusy(""); }
  }

  const files = filesStatus(rec);
  const skipped = skippedSummary(rec);
  const github = rec.provider === "github";
  const manage = rec.can_manage;
  const revoked = !!rec.link?.access_revoked && !rec.link.remove_requested;
  const agentsText = !rec.agents ? "выключены — агенты не видят этот код"
    : rec.agents_access_revoked ? "доступ отозван в GitHub — агенты не работают. Выключите и включите их тому, кому GitHub открывает этот репозиторий"
    : (waiting.value ?? 0) > 0 ? `включены · ${waiting.value} ${plural(waiting.value ?? 0, "ветка ждёт", "ветки ждут", "веток ждут")} «Принять»`
    : "включены · агенты работают в своих ветках, в основную — после «Принять»";

  return <div data-record={rec.project_id} className="mx-4 mb-3.5 rounded-xl bg-kumo-base px-3.5 py-3 sm:mr-5 sm:ml-[60px]">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 flex-1 text-[14px] text-kumo-default">Проект <strong className="font-medium">«{projectName(data.projects, rec.project_id)}»</strong>{rec.branch ? <span className="text-kumo-subtle">, ветка {rec.branch}</span> : null}</span>
      {project && <Pill tone="ghost" onClick={() => void host.openSection("projects", rec.project_id).catch(() => setError("Проект не открылся. Откройте его в разделе «Проекты»."))}>Открыть проект</Pill>}
    </div>
    {revoked && <div role="alert" className="mt-2.5 grid gap-2 rounded-lg bg-kumo-warning-tint px-3 py-2.5 text-[13px] text-kumo-warning">
      <span><strong className="font-semibold">Доступ отозван в GitHub.</strong> Файлы в проекте остались. Оставьте их копией или уберите из проекта.</span>
      {manage && confirm !== "remove" && <span className="flex flex-wrap gap-1.5">
        <Pill tone="secondary" disabled={!!busy} onClick={() => void act("keep")}>Оставить копию</Pill>
        <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("remove")}>Убрать файлы из проекта</Pill>
      </span>}
      {manage && confirm === "remove" && <span className="flex flex-wrap items-center gap-1.5">
        <span>Уберём файлы, которые никто не правил в Mnemos; изменённые останутся.</span>
        <Pill tone="danger" disabled={!!busy} onClick={() => void act("remove")}>Да, убрать</Pill>
        <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("")}>Отмена</Pill>
      </span>}
    </div>}
    <div className="relative mt-3 grid gap-3 border-l border-kumo-fill-hover pl-3.5">
      <Capability title="Файлы в проекте" checked={rec.files} disabled={!manage || !github || !!rec.link?.remove_requested} busy={busy === "files"} status={files.text} tone={files.tone} onChange={next => void change("files", next)}>
        {rec.files && skipped.total > 0 && <button type="button" aria-expanded={showSkipped} onClick={() => setShowSkipped(!showSkipped)} className="mt-0.5 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[13px] text-kumo-brand hover:underline">
          {skipped.text}<CaretDown size={11} aria-hidden="true" className={`transition-transform ${showSkipped ? "rotate-180" : ""}`} />
        </button>}
        {showSkipped && <ul aria-label="Пропущенные файлы" className="m-0 mt-1.5 grid max-h-[180px] list-none gap-0.5 overflow-y-auto rounded-lg border border-kumo-fill bg-kumo-overlay p-2">
          {(rec.link?.skipped ?? []).map(s => <li key={s.path} className="flex gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate font-mono text-kumo-default">{s.path}</span><span className="shrink-0 text-kumo-subtle">{s.reason === "binary" ? "двоичный" : "больше 1 МБ"}</span></li>)}
        </ul>}
      </Capability>
      <Capability title="Агенты кода" checked={rec.agents} disabled={!manage} busy={busy === "agents"} status={agentsText} tone={rec.agents_access_revoked || (waiting.value ?? 0) > 0 ? "attention" : "ok"} onChange={next => void change("agents", next)} />
    </div>
    {!manage && <p className="mt-2.5 mb-0 text-[12px] text-kumo-subtle">Переключают владелец проекта и администратор организации.</p>}
    {consent && <div role="alert" className="mt-3 grid gap-2 rounded-lg border border-kumo-warning bg-kumo-warning-tint px-3 py-2.5 text-[13px] text-kumo-warning">
      <span>Код приватного репозитория «{rec.repository_name}» увидят все, кому открыт проект «{projectName(data.projects, rec.project_id)}»{project?.visibility === "organization" ? " — вся организация" : project?.visibility === "department" ? " — все сотрудники отдела" : ""}, даже если в GitHub у них доступа нет.</span>
      <span className="flex flex-wrap gap-1.5">
        <Pill tone="primary" disabled={!!busy} onClick={() => void change(consent.change, consent.next, true)}>Понимаю, включить</Pill>
        <Pill tone="ghost" disabled={!!busy} onClick={() => setConsent(null)}>Отмена</Pill>
      </span>
    </div>}
    {error && <div className="mt-2.5"><Notice tone="danger">{error}</Notice></div>}
    {done && <div className="mt-2.5"><Notice tone="success">{done}</Notice></div>}
    {manage && <div className="mt-2.5 -ml-2 flex flex-wrap items-center gap-0.5">
      {rec.files && rec.link && !revoked && <Pill tone="ghost" disabled={!!busy} onClick={() => void act("refresh")}>Обновить сейчас</Pill>}
      {confirm !== "detach" && <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("detach")}>Отвязать</Pill>}
      {confirm === "detach" && <span className="flex flex-wrap items-center gap-1.5 pl-2">
        <span className="text-[13px] text-kumo-subtle">Отвязать? Файлы останутся в проекте, агенты перестанут видеть код.</span>
        <Pill tone="danger" disabled={!!busy} onClick={() => void act("detach")}>Да, отвязать</Pill>
        <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("")}>Отмена</Pill>
      </span>}
    </div>}
  </div>;
}

/** Кто увидит код: подтверждение для отдела и организации, «Вся организация» — только администратору. */
function privacyNeed(priv: boolean | null, level: RepositoryVisibility | "", admin: boolean): "none" | "consent" | "admin" {
  if (!priv || !level || level === "private") return "none";
  if (level === "organization" && !admin) return "admin";
  return "consent";
}

/** «Создать проект» или «Добавить в проект…» раскрываются в строке. Всё видно сразу; ветка и шаблоны — в «Дополнительно». */
function AddRepository({ mode, row, data, admin, taken, onCancel, onDone }: { mode: "create" | "add"; row: RepoRow; data: MemoryData; admin: boolean; taken: string[]; onCancel(): void; onDone(text: string, project?: string): Promise<void> }) {
  const ui = useUi();
  const host = useHost();
  const github = row.provider === "github";
  const [name, setName] = useState(row.short);
  const [visibility, setVisibility] = useState<RepositoryVisibility>("private");
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("");
  const [files, setFiles] = useState(github);
  const [agents, setAgents] = useState(!github);
  const [more, setMore] = useState(false);
  const [branch, setBranch] = useState(row.branch || "");
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  const chosen = data.projects.find(p => p.id === project);
  const level: RepositoryVisibility | "" = mode === "create" ? visibility : chosen?.visibility ?? "";
  // Сервер знает о приватности больше строки (ответ провайдера): его отказ «подтвердите» включает вопрос.
  const [serverPrivate, setServerPrivate] = useState(false);
  const basic = privacyNeed(row.private || serverPrivate, level, admin);
  // Видимость проекта интерфейсу может быть неизвестна — тогда вопрос задаётся по ответу сервера.
  const need = serverPrivate && basic === "none" ? "consent" : basic;
  const branchName = branch.trim() || row.branch;
  const cleanFolder = (folder.trim() || row.short).replace(/^\/+|\/+$/g, "");
  const ready = !busy && (files || agents) && need !== "admin" && (need !== "consent" || agreed) && (mode === "create" ? !!name.trim() : !!project);
  useEffect(() => setAgreed(false), [level]);

  async function submit() {
    if (!ready || !row.entry) return;
    setBusy(true); setError("");
    const entry = row.entry;
    const input: RepositoryInput = { source: entry.source, repository_id: entry.id, repository_name: row.name, files, agents,
      ...(entry.source === "app" ? { installation_id: entry.installation } : { connection_id: entry.connection }),
      ...(branchName ? { branch: branchName } : {}), ...(files ? { include, exclude } : {}), ...(need === "consent" ? { consent: true } : {}),
      ...(mode === "create" ? { name: name.trim(), visibility, folder: "" } : { project_id: project, folder: files ? cleanFolder : "" }) };
    try {
      const out = await ui.addRepository(input);
      const target = out.project?.id ?? project;
      const title = out.project?.name ?? chosen?.name ?? "";
      const what = [files ? "файлы начали загружаться" : "", agents ? "агенты кода включены" : ""].filter(Boolean).join(", ");
      await onDone(out.message || (mode === "create" ? `Проект «${title}» создан: ${what}.` : `«${row.name}» добавлен в проект «${title}»: ${what}.`), out.project?.id);
      if (mode === "create" && target) await host.openSection("projects", target).catch(() => {});
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (message === REPOSITORY_FAILURES["project.private_code_consent"] && !serverPrivate) { setServerPrivate(true); return; }
      setError(/[а-яё]/i.test(message) ? message : mode === "create" ? "Проект не создан. Проверьте название и повторите; если не выйдет — добавьте репозиторий в существующий проект." : "Репозиторий не добавлен. Проверьте, что вы владелец проекта, и повторите.");
    } finally { setBusy(false); }
  }

  const needle = search.trim().toLowerCase();
  const projects = data.projects.filter(p => !needle || p.name.toLowerCase().includes(needle));
  const audience = level === "organization" ? "все сотрудники организации" : "все сотрудники отдела";
  return <ActionForm aria-label={mode === "create" ? `Создать проект из ${row.name}` : `Добавить ${row.name} в проект`} onAction={() => void submit()}
    className="grid gap-4 border-t border-kumo-fill bg-kumo-base px-4 py-4 sm:pl-[60px]">
    {mode === "create" ? <>
      <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Название проекта
        <input ref={first} aria-label="Название проекта" value={name} maxLength={255} disabled={busy} onChange={e => setName(e.target.value)}
          className="h-10 w-full max-w-[420px] rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none focus:border-kumo-ring" />
      </label>
      <div className="grid gap-1.5">
        <span id={`who-${row.key}`} className="text-[13px] text-kumo-subtle">Кто видит</span>
        <div role="radiogroup" aria-labelledby={`who-${row.key}`} className="flex flex-wrap gap-1.5">
          {VISIBILITY.map(v => {
            const locked = privacyNeed(row.private, v.id, admin) === "admin";
            return <button key={v.id} type="button" role="radio" aria-checked={visibility === v.id} disabled={busy || locked} onClick={() => setVisibility(v.id)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors disabled:cursor-not-allowed ${visibility === v.id ? "border-kumo-brand bg-kumo-tint font-medium text-kumo-brand" : locked ? "border-kumo-fill bg-transparent text-kumo-inactive" : "border-kumo-fill-hover bg-kumo-overlay text-kumo-default hover:bg-kumo-tint"}`}>
              {visibility === v.id && <Check size={13} weight="bold" aria-hidden="true" />}{v.label}
            </button>;
          })}
        </div>
        {row.private && !admin && <span className="text-[12px] text-kumo-subtle">Приватный код всей организации открывает только администратор.</span>}
      </div>
    </> : <>
      <div className="grid gap-1.5">
        <label className="flex h-9 max-w-[420px] items-center gap-2 rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3">
          <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
          <input ref={first} aria-label="Найти проект" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} placeholder="Найти проект"
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-kumo-default outline-none placeholder:text-kumo-inactive" />
        </label>
        <div role="radiogroup" aria-label="Проект" className="grid max-h-[208px] max-w-[420px] gap-0.5 overflow-y-auto rounded-xl border border-kumo-fill bg-kumo-overlay p-1">
          {projects.map(p => <ProjectChoice key={p.id} p={p} selected={project === p.id} already={taken.includes(p.id)} locked={privacyNeed(row.private, p.visibility ?? "", admin) === "admin"} disabled={busy} onPick={() => setProject(p.id)} />)}
          {projects.length === 0 && <p className="m-0 px-2.5 py-2 text-[13px] text-kumo-subtle">{data.projects.length ? "Такого проекта нет." : "У вас пока нет проектов."}</p>}
        </div>
      </div>
    </>}
    <div className="grid gap-2.5" role="group" aria-label="Что включить">
      <span className="text-[13px] text-kumo-subtle">Что включить</span>
      <Capability title="Файлы в проекте" checked={files} disabled={busy || !github} status={github ? "файлы репозитория попадают в проект и обновляются сами; двоичные и больше 1 МБ не переносятся" : "переносятся только из GitHub"} tone="ok" onChange={setFiles} />
      <Capability title="Агенты кода" checked={agents} disabled={busy} status="агенты работают в своих ветках; в основную ветку — после «Принять»" tone="ok" onChange={setAgents} />
    </div>
    {files && mode === "add" && <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Папка в проекте
      <input aria-label="Папка в проекте" value={folder} disabled={busy} onChange={e => setFolder(e.target.value)} placeholder={row.short}
        className="h-10 w-full max-w-[420px] rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none placeholder:text-kumo-inactive focus:border-kumo-ring" />
    </label>}
    <div className="grid gap-3">
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="inline-flex w-fit items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-medium text-kumo-brand hover:underline">
        Дополнительно<CaretDown size={12} aria-hidden="true" className={`transition-transform ${more ? "rotate-180" : ""}`} />
      </button>
      {more && <div className="grid gap-3">
        <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Ветка — её видит проект, в неё принимается работа агентов
          <input aria-label="Ветка" value={branch} disabled={busy} onChange={e => setBranch(e.target.value)} placeholder={row.branch}
            className="h-9 w-full max-w-[260px] rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[14px] text-kumo-default outline-none focus:border-kumo-ring" />
        </label>
        {files && <Patterns label="Брать только" hint="Пусто — берутся все файлы ветки." hints={TAKE_HINTS} value={include} onChange={setInclude} disabled={busy} />}
        {files && <Patterns label="Пропускать" hints={SKIP_HINTS} value={exclude} onChange={setExclude} disabled={busy} />}
      </div>}
    </div>
    {need === "consent" && <label className="flex max-w-[560px] items-start gap-2.5 rounded-xl border border-kumo-warning bg-kumo-warning-tint px-3 py-2.5 text-[13px] text-kumo-warning">
      <input type="checkbox" aria-label="Подтверждаю, что код увидят все, кому открыт проект" checked={agreed} disabled={busy} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-kumo-brand" />
      <span>Понимаю: код приватного репозитория «{row.name}» увидят {audience}, даже если в GitHub у них доступа к нему нет.</span>
    </label>}
    {need === "admin" && mode === "add" && <Notice tone="danger">Проект открыт всей организации: приватный код туда добавляет только администратор.</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
    <div className="flex flex-wrap items-center gap-2">
      <Pill data-submit="" tone="primary" size="md" disabled={!ready} onClick={() => void submit()}>{busy ? (mode === "create" ? "Создаём проект…" : "Добавляем…") : mode === "create" ? "Создать проект" : chosen ? `Добавить в «${chosen.name}»` : "Выберите проект"}</Pill>
      <Pill tone="ghost" size="md" disabled={busy} onClick={onCancel}>Отмена</Pill>
    </div>
  </ActionForm>;
}

function ProjectChoice({ p, selected, already, locked, disabled, onPick }: { p: ProjectData; selected: boolean; already: boolean; locked: boolean; disabled: boolean; onPick(): void }) {
  const note = already ? "уже есть" : locked ? "открыт всей организации" : p.visibility === "department" ? "отдел" : p.visibility === "organization" ? "вся организация" : "";
  return <button type="button" role="radio" aria-checked={selected} disabled={disabled || already || locked} onClick={onPick}
    className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[14px] ${selected ? "bg-kumo-tint font-medium text-kumo-brand" : already || locked ? "cursor-not-allowed text-kumo-inactive" : "text-kumo-default hover:bg-kumo-tint"}`}>
    <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{selected && <Check size={14} weight="bold" />}</span>
    <span className="min-w-0 flex-1 truncate">{p.name}</span>
    {note && <span className="text-[12px] text-kumo-subtle">{note}</span>}
  </button>;
}

/** Шаблоны файлов чипами: подсказки добавляются нажатием, свой — клавишей Enter. */
function Patterns({ label, hint, hints, value, onChange, disabled }: { label: string; hint?: ReactNode; hints: string[]; value: string[]; onChange(next: string[]): void; disabled: boolean }) {
  const [draft, setDraft] = useState("");
  const add = (p: string) => { const t = p.trim(); if (t && !value.includes(t) && value.length < 50 && t.length <= 255) onChange([...value, t]); setDraft(""); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); e.stopPropagation(); add(draft); }
    else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  const free = hints.filter(h => !value.includes(h));
  return <div className="grid gap-1.5" role="group" aria-label={label}>
    <span className="text-[13px] text-kumo-subtle">{label}</span>
    <div className="flex max-w-[560px] flex-wrap items-center gap-1.5 rounded-xl border border-kumo-fill-hover bg-kumo-overlay p-1.5 focus-within:border-kumo-ring">
      {value.map(p => <span key={p} className="inline-flex h-7 items-center gap-1 rounded-full bg-kumo-tint pr-1 pl-2.5 font-mono text-[12px] text-kumo-default">
        {p}<button type="button" aria-label={`Убрать ${p}`} disabled={disabled} onClick={() => onChange(value.filter(v => v !== p))} className="flex h-5 w-5 items-center justify-center rounded-full border-0 bg-transparent text-kumo-subtle hover:bg-kumo-fill"><X size={11} /></button>
      </span>)}
      <input aria-label={`${label}: свой шаблон`} value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onKeyDown={key} onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? "" : "Шаблон и Enter"} className="h-7 min-w-[120px] flex-1 border-0 bg-transparent px-1 font-mono text-[12px] text-kumo-default outline-none placeholder:font-sans placeholder:text-kumo-inactive" />
    </div>
    {free.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
      {free.map(h => <button key={h} type="button" disabled={disabled} onClick={() => add(h)} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-kumo-fill-hover bg-transparent px-2.5 font-mono text-[12px] text-kumo-subtle hover:border-kumo-brand hover:text-kumo-brand">
        <Plus size={11} aria-hidden="true" />{h}
      </button>)}
    </div>}
    {hint && value.length === 0 && <span className="text-[12px] text-kumo-subtle">{hint}</span>}
  </div>;
}

/** Источники доступа к коду: аккаунты GitHub (через приложение), внутреннее хранилище организации и ключи. */
function Sources({ overview, accounts, keys, records, onChanged }: { overview: RepositoryOverview | null; accounts: { value: Awaited<ReturnType<ReturnType<typeof useUi>["listGitHubAccounts"]>> | null; error: string; loading: boolean; reload(): Promise<void> }; keys: GitConnection[]; records: RepositoryRecord[]; onChanged(): void }) {
  const ui = useUi();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [more, setMore] = useState(false);
  const internalProjects = new Set(records.filter(r => r.source === "internal").map(r => r.project_id)).size;
  async function disconnect(id: string, run: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(id); setNotice(null);
    try { await run(); setConfirm(""); setNotice({ tone: "success", text: done }); onChanged(); }
    catch (e) { const m = e instanceof Error ? e.message : ""; setNotice({ tone: "danger", text: /[а-яё]/i.test(m) ? m : "Отключение не подтверждено. Обновите страницу и проверьте ещё раз." }); }
    finally { setBusy(""); }
  }
  const confirmRow = (id: string, question: string, run: () => Promise<unknown>, done: string) => confirm === id
    ? <span className="flex basis-full flex-wrap items-center gap-1.5 pt-1 sm:pl-[46px]">
      <span className="text-[13px] text-kumo-subtle">{question}</span>
      <Pill tone="danger" disabled={!!busy} onClick={() => void disconnect(id, run, done)}>Да, отключить</Pill>
      <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("")}>Отмена</Pill>
    </span>
    : <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm(id)}>Отключить</Pill>;

  return <section aria-label="Источники">
    <h2 className="m-0 mb-2.5 text-[17px] font-semibold text-kumo-default">Источники</h2>
    {notice && <div className="mb-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
    <div className="overflow-hidden rounded-2xl border border-kumo-fill bg-kumo-overlay">
      <div data-source="github" className="px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-3">
          <SourceIcon><GithubLogo size={17} /></SourceIcon>
          <span className="block min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-kumo-default">GitHub</span>
            <span className="block text-[13px] text-kumo-subtle">{overview?.app_configured === false ? "Приложение GitHub не настроено на сервере: обратитесь к администратору." : "Через приложение Mnemos: каждый подключает свои аккаунты, репозитории видны тем, кому их открыл GitHub."}</span>
          </span>
        </div>
        {/* На узком экране имя аккаунта занимает строку целиком, кнопки уходят ниже. */}
        {overview?.app_configured !== false && <div className="text-[13px] sm:pl-[46px] [&_[data-github-account]>span:first-child]:basis-full sm:[&_[data-github-account]>span:first-child]:basis-0">
<GitHubAccounts accounts={accounts} reload={accounts.reload} changed={onChanged} /></div>}
      </div>
      {overview?.internal.available && <div data-source="internal" className="flex flex-wrap items-center gap-3 border-t border-kumo-fill px-4 py-3.5 sm:px-5">
        <SourceIcon><HardDrives size={17} /></SourceIcon>
        <span className="block min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-kumo-default">Внутреннее хранилище Mnemos</span>
          <span className="block text-[13px] text-kumo-subtle">ресурс организации · {internalProjects} {plural(internalProjects, "проект", "проекта", "проектов")} · репозиторий закреплён за своим проектом</span>
        </span>
        {overview.internal.can_disable && overview.internal.revision && confirmRow("internal", "Хранилище выключится для всей организации: агенты кода и код проектов в нём перестанут работать.",
          () => ui.disableInternalCodeHosting(overview.internal.revision ?? 0), "Внутреннее хранилище кода отключено для всей организации.")}
      </div>}
      {keys.map(k => <div key={k.connection_id} data-source="key" className="flex flex-wrap items-center gap-3 border-t border-kumo-fill px-4 py-3.5 sm:px-5">
        <SourceIcon><Key size={17} /></SourceIcon>
        <span className="block min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-kumo-default">{k.name || (k.provider === "gitlab" ? "GitLab" : "GitHub")}</span>
          <span className="block text-[13px] text-kumo-subtle">{k.provider === "gitlab" ? "GitLab" : "GitHub"} · ключ доступа{k.account_login ? ` · ${k.account_login}` : ""}</span>
        </span>
        {confirmRow(`key/${k.connection_id}`, "Отключить? Проекты с репозиториями этого ключа перестанут обновляться.", () => ui.disableGitConnection(k.connection_id, k.revision), `«${k.name || "Ключ доступа"}» отключён.`)}
      </div>)}
      <div className="border-t border-kumo-fill px-4 py-3 sm:px-5">
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-medium text-kumo-brand hover:underline">
          Дополнительно<CaretDown size={12} aria-hidden="true" className={`transition-transform ${more ? "rotate-180" : ""}`} />
        </button>
        {more && <KeyForm onDone={() => { setMore(false); onChanged(); }} />}
      </div>
    </div>
  </section>;
}

function SourceIcon({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-kumo-tint text-kumo-default">{children}</span>;
}

const KEY_SERVICES = [
  { id: "gitlab", title: "GitLab.com", api: "https://gitlab.com/api/v4", provider: "gitlab" },
  { id: "own", title: "Свой сервер GitLab", api: "", provider: "gitlab" },
  { id: "github", title: "GitHub ключом", api: "https://api.github.com", provider: "github" },
] as const;

/** «Подключить GitLab или свой сервер»: ключ доступа. GitHub ключом — запасной путь, если приложению не дали права записи. */
function KeyForm({ onDone }: { onDone(): void }) {
  const ui = useUi();
  const [service, setService] = useState<(typeof KEY_SERVICES)[number]["id"]>("gitlab");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = KEY_SERVICES.find(s => s.id === service)!;
  const own = address.trim().replace(/\/$/, "");
  const api = service === "own" ? own + (own && !/\/api\/v4$/.test(own) ? "/api/v4" : "") : chosen.api;
  async function submit() {
    if (busy || !name.trim() || !token || !api) return;
    setBusy(true); setError("");
    try {
      const intent = await ui.saveGitRegistrationIntent({ provider: chosen.provider, api_base: api, name: name.trim() });
      await ui.executeGitRegistrationIntent(intent.id, token, false);
      setToken(""); onDone();
    } catch { setToken(""); setError("Не подключилось. Проверьте ключ доступа и адрес сервера."); }
    finally { setBusy(false); }
  }
  return <ActionForm aria-label="Подключить GitLab или свой сервер" onAction={() => void submit()} className="mt-3 grid max-w-[480px] gap-3 text-[14px]">
    <p className="m-0 text-[13px] font-medium text-kumo-default">Подключить GitLab или свой сервер</p>
    <div role="radiogroup" aria-label="Где код" className="flex flex-wrap gap-1.5">
      {KEY_SERVICES.map(s => <button key={s.id} type="button" role="radio" aria-checked={service === s.id} disabled={busy} onClick={() => setService(s.id)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] ${service === s.id ? "border-kumo-brand bg-kumo-tint font-medium text-kumo-brand" : "border-kumo-fill-hover bg-kumo-overlay text-kumo-default hover:bg-kumo-tint"}`}>
        {service === s.id && <Check size={13} weight="bold" aria-hidden="true" />}{s.title}
      </button>)}
    </div>
    {service === "github" && <p className="m-0 text-[12px] text-kumo-subtle">Запасной путь: обычно GitHub подключается через приложение выше. Ключ нужен, если приложению Mnemos не дали права записи для агентов кода.</p>}
    {service === "own" && <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Адрес сервера GitLab
      <input aria-label="Адрес сервера GitLab" value={address} disabled={busy} onChange={e => setAddress(e.target.value)} placeholder="https://gitlab.company.ru" className="h-10 rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none focus:border-kumo-ring" />
    </label>}
    <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Название
      <input aria-label="Название подключения" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Например, Код компании" className="h-10 rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none focus:border-kumo-ring" />
    </label>
    <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Ключ доступа
      <input aria-label="Ключ доступа" type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} className="h-10 rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none focus:border-kumo-ring" />
    </label>
    <p className="m-0 text-[12px] text-kumo-subtle">Ключ создаётся в настройках GitLab или GitHub. Он хранится на сервере памяти и не передаётся агентам.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    <div><Pill tone="primary" disabled={busy || !name.trim() || !token || !api} onClick={() => void submit()}>{busy ? "Подключаем…" : "Подключить"}</Pill></div>
  </ActionForm>;
}
