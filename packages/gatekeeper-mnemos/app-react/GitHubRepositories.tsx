import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CaretDown, Check, GlobeSimple, LockSimple, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import type { GitAppRepository, GitSyncLink, GitSyncVisibility } from "../src/mnemos-api.ts";
import { useHost, useUi } from "./host.ts";
import { projectName, useLoad, type MemoryData } from "./data.ts";
import { ActionForm, Notice } from "./ui.tsx";
import { Pill, plural } from "./admin-ui.tsx";
import { relativeTime } from "./time.ts";

/** Репозиторий строкой списка: из приложения GitHub или из личного ключа доступа GitHub. */
export interface RepoRow {
  key: string;
  id: string;
  name: string;
  short: string;
  account: string;
  branch: string;
  private: boolean | null;
  pushedAt: string;
  language: string;
  source: "app" | "connection";
  installation: string;
  connection: string;
}

type Loaded<T> = { value: T | null; error: string; loading: boolean; reload(): Promise<void> };

const VISIBILITY: { id: GitSyncVisibility; label: string }[] = [
  { id: "private", label: "Только я" },
  { id: "department", label: "Мой отдел" },
  { id: "organization", label: "Вся организация" },
];
const TAKE_HINTS = ["docs/**", "src/**", "*.md"];
const SKIP_HINTS = ["tests/**", "*.lock", "node_modules/**", "dist/**"];
/** Поиск появляется, когда строк больше, чем помещается на экран без прокрутки. */
const SEARCH_FROM = 6;

export function repoFromApp(r: GitAppRepository): RepoRow {
  const [account, short] = r.name.includes("/") ? [r.name.slice(0, r.name.indexOf("/")), r.name.slice(r.name.indexOf("/") + 1)] : [r.account ?? "", r.name];
  return { key: `app/${r.installation_id}/${r.id}`, id: r.id, name: r.name, short, account: r.account || account, branch: r.default_branch, private: r.private,
    pushedAt: r.pushed_at ?? "", language: r.language ?? "", source: "app", installation: r.installation_id, connection: "" };
}

/** Состояние связи словами: когда обновлялась, сколько файлов, что пошло не так. */
export function linkState(l: GitSyncLink, now = Date.now()): { text: string; tone: "ok" | "busy" | "danger" } {
  const files = l.file_count ?? 0;
  const count = `${files} ${plural(files, "файл", "файла", "файлов")}`;
  switch (l.state) {
    case "ok": return { text: `синхронизирован ${l.last_synced_at ? relativeTime(l.last_synced_at, now) : "только что"} · ${count}`, tone: "ok" };
    case "pending": case "syncing": return { text: files > 0 ? `идёт синхронизация · уже ${count}` : l.last_synced_at ? "идёт синхронизация" : "идёт первая загрузка", tone: "busy" };
    case "conflict": return { text: "конфликт: файл изменён и в Mnemos, и в GitHub — разрешите его в проекте", tone: "danger" };
    case "disabled": return { text: "отвязан", tone: "ok" };
    default: return { text: l.message || "обновление не прошло — нажмите «Обновить сейчас»", tone: "danger" };
  }
}

const TONE = { ok: "bg-kumo-brand", busy: "bg-kumo-warning", danger: "bg-kumo-danger" } as const;

/** Репозитории GitHub списком: у несвязанного — «Создать проект» и «Добавить в проект…», у связанного — его проект,
 * состояние синхронизации и действия. Ни одного выпадающего списка: проект выбирается поиском, видимость — чипами. */
export default function GitHubRepositories({ data, repos, links, canCreate }: { data: MemoryData; repos: Loaded<RepoRow[]>; links: Loaded<{ links: GitSyncLink[] }>; canCreate: boolean }) {
  const ui = useUi();
  const host = useHost();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ key: string; mode: "create" | "add" } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const active = (links.value?.links ?? []).filter(l => l.state !== "disabled");
  const syncing = active.some(l => l.state === "pending" || l.state === "syncing");
  // Пока идёт загрузка, состояние перечитывается само: человек видит ход, не обновляя страницу.
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => void links.reload(), 5000);
    return () => clearInterval(timer);
  }, [syncing, links.reload]);

  const rows = useMemo(() => {
    const list = [...(repos.value ?? [])];
    // Связь, чей репозиторий не виден в ваших аккаунтах (связал коллега), тоже строка: её состояние важно.
    for (const l of active) if (!list.some(r => r.id === l.repository_id)) {
      const slash = l.repository_name.indexOf("/");
      list.push({ key: `link/${l.link_id}`, id: l.repository_id, name: l.repository_name, short: slash >= 0 ? l.repository_name.slice(slash + 1) : l.repository_name, account: slash >= 0 ? l.repository_name.slice(0, slash) : "",
        branch: l.branch, private: null, pushedAt: "", language: "", source: l.source, installation: l.installation_id, connection: l.connection_id });
    }
    const linked = (r: RepoRow) => active.some(l => l.repository_id === r.id);
    return list.sort((a, b) => Number(linked(b)) - Number(linked(a)) || (Date.parse(b.pushedAt) || 0) - (Date.parse(a.pushedAt) || 0) || a.name.localeCompare(b.name));
  }, [repos.value, links.value]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? rows.filter(r => r.name.toLowerCase().includes(needle) || r.language.toLowerCase().includes(needle)) : rows;

  async function act(link: GitSyncLink, kind: "refresh" | "remove") {
    if (busy) return;
    setBusy(link.link_id); setNotice(null);
    try {
      if (kind === "refresh") { await ui.refreshGitSyncLink(link.link_id); setNotice({ tone: "success", text: `«${link.repository_name}» обновится в ближайшие минуты.` }); }
      else { await ui.deleteGitSyncLink(link.link_id, link.revision); setConfirm(""); setNotice({ tone: "success", text: `«${link.repository_name}» отвязан от проекта «${projectName(data.projects, link.project_id)}». Файлы остались в проекте.` }); }
      await links.reload();
    } catch { setNotice({ tone: "danger", text: "Не получилось. Обновите страницу и проверьте, что вы владелец проекта." }); }
    finally { setBusy(""); }
  }

  const loading = repos.loading && !repos.value;
  return <div className="mt-4 grid gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="m-0 flex-1 text-[13px] font-medium">Репозитории{rows.length ? ` · ${rows.length}` : ""}</h4>
      {rows.length >= SEARCH_FROM && <label className="flex h-8 w-full items-center gap-2 rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 sm:w-[260px]">
        <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
        <input aria-label="Найти репозиторий" value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти по имени или языку" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-kumo-default outline-none placeholder:text-kumo-inactive" />
      </label>}
    </div>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {loading && <Notice>Загрузка репозиториев…</Notice>}
    {repos.error && <Notice tone="danger">{repos.error}</Notice>}
    {links.error && <Notice tone="danger">{links.error}</Notice>}
    {!loading && !repos.error && rows.length === 0 && <p className="m-0 text-[13px] text-kumo-subtle">Приложению Mnemos не открыт ни один репозиторий. Нажмите «Изменить доступ» у аккаунта выше и выберите репозитории.</p>}
    {shown.length > 0 && <ul aria-label="Репозитории GitHub" className="m-0 list-none overflow-hidden rounded-2xl border border-kumo-fill bg-kumo-overlay p-0">
      {shown.map(r => {
        const mine = active.filter(l => l.repository_id === r.id);
        const expanded = open?.key === r.key ? open.mode : null;
        const toggle = (mode: "create" | "add") => { setNotice(null); setOpen(expanded === mode ? null : { key: r.key, mode }); };
        return <li key={r.key} data-repo={r.name} className="border-t border-kumo-fill first:border-t-0">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
            <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-kumo-tint text-kumo-default">{r.private === false ? <GlobeSimple size={16} /> : <LockSimple size={16} />}</span>
            <span className="block min-w-[180px] flex-1">
              <span className="block text-[15px] font-medium break-words text-kumo-default">{r.short}{r.account && <span className="font-normal text-kumo-subtle"> · {r.account}</span>}</span>
              <span className="block text-[13px] text-kumo-subtle">{repoMeta(r)}</span>
            </span>
            {r.key.startsWith("link/") ? null : <span className="flex flex-wrap items-center gap-1.5">
              {canCreate && mine.length === 0 && <Pill tone={expanded === "create" ? "secondary" : "primary"} aria-expanded={expanded === "create"} onClick={() => toggle("create")}>Создать проект</Pill>}
              <Pill tone={canCreate || mine.length ? "ghost" : "secondary"} aria-expanded={expanded === "add"} onClick={() => toggle("add")}>{mine.length ? "Добавить ещё в проект…" : "Добавить в проект…"}</Pill>
            </span>}
          </div>
          {mine.map(l => {
            const state = linkState(l);
            return <div key={l.link_id} data-sync-link="" className="grid gap-1 px-4 pb-3 sm:pl-[60px]">
              <span className="flex items-start gap-2 text-[13px]">
                <span aria-hidden="true" className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${TONE[state.tone]}`} />
                <span className={state.tone === "danger" ? "text-kumo-danger" : "text-kumo-default"}>
                  В проекте «{projectName(data.projects, l.project_id)}»{l.folder ? `, папка «${l.folder}»` : ""}{l.branch !== r.branch ? `, ветка ${l.branch}` : ""}
                  <span className={state.tone === "danger" ? "" : "text-kumo-subtle"}> — {state.text}</span>
                </span>
              </span>
              <span className="-ml-3 flex flex-wrap items-center gap-0.5 pl-3.5">
                <Pill tone="ghost" onClick={() => void host.openSection("projects", l.project_id).catch(() => setNotice({ tone: "danger", text: "Проект не открылся. Откройте его в разделе «Проекты»." }))}>Открыть проект</Pill>
                {l.can_manage && <Pill tone="ghost" disabled={!!busy} onClick={() => void act(l, "refresh")}>Обновить сейчас</Pill>}
                {l.can_manage && confirm !== l.link_id && <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm(l.link_id)}>Отвязать</Pill>}
                {l.can_manage && confirm === l.link_id && <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] text-kumo-subtle">Отвязать? Файлы останутся в проекте.</span>
                  <Pill tone="danger" disabled={!!busy} onClick={() => void act(l, "remove")}>Да, отвязать</Pill>
                  <Pill tone="ghost" disabled={!!busy} onClick={() => setConfirm("")}>Отмена</Pill>
                </span>}
              </span>
            </div>;
          })}
          {expanded && <RepoAction key={expanded} mode={expanded} repo={r} data={data} taken={mine.map(l => l.project_id)}
            onCancel={() => setOpen(null)}
            onDone={async (text, project) => { setOpen(null); setNotice({ tone: "success", text }); await links.reload(); if (project) { await data.reloadProjects(); await host.openSection("projects", project).catch(() => {}); } }} />}
        </li>;
      })}
    </ul>}
    {needle && shown.length === 0 && <p className="m-0 text-[13px] text-kumo-subtle">Ничего не нашлось по «{query.trim()}».</p>}
  </div>;
}

function repoMeta(r: RepoRow): string {
  const parts = [r.private === null ? "" : r.private ? "приватный" : "публичный", r.language, r.pushedAt ? `изменён ${relativeTime(r.pushedAt)}` : ""].filter(Boolean);
  return parts.join(" · ") || `ветка ${r.branch}`;
}

/** Раскрытое действие по строке: «Создать проект» или «Добавить в проект…». Всё видно сразу; ветка и шаблоны — в «Дополнительно». */
function RepoAction({ mode, repo, data, taken, onCancel, onDone }: { mode: "create" | "add"; repo: RepoRow; data: MemoryData; taken: string[]; onCancel(): void; onDone(text: string, project?: string): Promise<void> }) {
  const ui = useUi();
  const [name, setName] = useState(repo.short);
  const [visibility, setVisibility] = useState<GitSyncVisibility>("private");
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("");
  const [more, setMore] = useState(false);
  const [branch, setBranch] = useState(repo.branch || "");
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  const branchName = branch.trim() || repo.branch;
  const cleanFolder = (folder.trim() || repo.short).replace(/^\/+|\/+$/g, "");
  const ready = !busy && !!branchName && (mode === "create" ? !!name.trim() : !!project);
  const chosen = data.projects.find(p => p.id === project);
  async function submit() {
    if (!ready) return;
    setBusy(true); setError("");
    const source = repo.source === "app" ? { source: "app" as const, installation_id: repo.installation } : { source: "connection" as const, connection_id: repo.connection };
    const settings = { ...source, repository_id: repo.id, repository_name: repo.name, branch: branchName, include, exclude };
    try {
      if (mode === "create") {
        const out = await ui.createProjectFromRepository({ ...settings, name: name.trim(), folder: "", visibility });
        await onDone(out.link.message || `Проект «${out.project.name}» создан, идёт первая загрузка файлов из GitHub.`, out.project.id);
      } else {
        const out = await ui.createGitSyncLink({ ...settings, project_id: project, folder: cleanFolder });
        await onDone(out.message || `«${repo.name}» добавлен в проект «${chosen?.name ?? ""}», папка «${cleanFolder}». Первая загрузка уже идёт.`);
      }
    } catch (e) {
      setError(e instanceof Error && /[а-яё]/i.test(e.message) ? e.message : mode === "create" ? "Проект не создан. Проверьте название и повторите; если не выйдет — добавьте репозиторий в существующий проект." : "Репозиторий не добавлен. Проверьте, что вы владелец проекта, и повторите.");
    } finally { setBusy(false); }
  }
  const needle = search.trim().toLowerCase();
  const projects = data.projects.filter(p => !needle || p.name.toLowerCase().includes(needle));
  return <ActionForm aria-label={mode === "create" ? `Создать проект из ${repo.name}` : `Добавить ${repo.name} в проект`} onAction={() => void submit()}
    className="grid gap-3.5 border-t border-kumo-fill bg-kumo-base px-4 py-4 sm:pl-[60px]">
    {mode === "create" ? <>
      <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Название проекта
        <input ref={first} aria-label="Название проекта" value={name} maxLength={255} disabled={busy} onChange={e => setName(e.target.value)}
          className="h-10 w-full max-w-[420px] rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none focus:border-kumo-ring" />
      </label>
      <div className="grid gap-1.5">
        <span id={`who-${repo.key}`} className="text-[13px] text-kumo-subtle">Кто видит</span>
        <div role="radiogroup" aria-labelledby={`who-${repo.key}`} className="flex flex-wrap gap-1.5">
          {VISIBILITY.map(v => <button key={v.id} type="button" role="radio" aria-checked={visibility === v.id} disabled={busy} onClick={() => setVisibility(v.id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${visibility === v.id ? "border-kumo-brand bg-kumo-tint font-medium text-kumo-brand" : "border-kumo-fill-hover bg-kumo-overlay text-kumo-default hover:bg-kumo-tint"}`}>
            {visibility === v.id && <Check size={13} weight="bold" aria-hidden="true" />}{v.label}
          </button>)}
        </div>
      </div>
    </> : <>
      <div className="grid gap-1.5">
        <label className="flex h-9 max-w-[420px] items-center gap-2 rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3">
          <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
          <input ref={first} aria-label="Найти проект" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} placeholder="Найти проект"
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-kumo-default outline-none placeholder:text-kumo-inactive" />
        </label>
        <div role="radiogroup" aria-label="Проект" className="grid max-h-[208px] max-w-[420px] gap-0.5 overflow-y-auto rounded-xl border border-kumo-fill bg-kumo-overlay p-1">
          {projects.map(p => {
            const already = taken.includes(p.id);
            return <button key={p.id} type="button" role="radio" aria-checked={project === p.id} disabled={busy || already} onClick={() => setProject(p.id)}
              className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[14px] ${project === p.id ? "bg-kumo-tint font-medium text-kumo-brand" : already ? "cursor-not-allowed text-kumo-inactive" : "text-kumo-default hover:bg-kumo-tint"}`}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{project === p.id && <Check size={14} weight="bold" />}</span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {already && <span className="text-[12px]">уже связан</span>}
            </button>;
          })}
          {projects.length === 0 && <p className="m-0 px-2.5 py-2 text-[13px] text-kumo-subtle">{data.projects.length ? "Такого проекта нет." : "У вас пока нет проектов."}</p>}
        </div>
      </div>
      <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Папка в проекте
        <input aria-label="Папка в проекте" value={folder} disabled={busy} onChange={e => setFolder(e.target.value)} placeholder={repo.short}
          className="h-10 w-full max-w-[420px] rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none placeholder:text-kumo-inactive focus:border-kumo-ring" />
      </label>
    </>}
    <div className="grid gap-3">
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="inline-flex w-fit items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-medium text-kumo-brand hover:underline">
        Дополнительно<CaretDown size={12} aria-hidden="true" className={`transition-transform ${more ? "rotate-180" : ""}`} />
      </button>
      {more && <div className="grid gap-3">
        <label className="grid gap-1.5 text-[13px] text-kumo-subtle">Ветка
          <input aria-label="Ветка" value={branch} disabled={busy} onChange={e => setBranch(e.target.value)} placeholder={repo.branch}
            className="h-9 w-full max-w-[260px] rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[14px] text-kumo-default outline-none focus:border-kumo-ring" />
        </label>
        <Patterns label="Брать только" hint="Пусто — берутся все файлы ветки." hints={TAKE_HINTS} value={include} onChange={setInclude} disabled={busy} />
        <Patterns label="Пропускать" hints={SKIP_HINTS} value={exclude} onChange={setExclude} disabled={busy} />
      </div>}
    </div>
    <p className="m-0 text-[12px] text-kumo-subtle">Двоичные файлы и файлы больше 1 МБ не переносятся.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    <div className="flex flex-wrap items-center gap-2">
      <Pill data-submit="" tone="primary" size="md" disabled={!ready} onClick={() => void submit()}>{busy ? (mode === "create" ? "Создаём проект…" : "Добавляем…") : mode === "create" ? "Создать проект" : chosen ? `Добавить в «${chosen.name}»` : "Выберите проект"}</Pill>
      <Pill tone="ghost" size="md" disabled={busy} onClick={onCancel}>Отмена</Pill>
    </div>
  </ActionForm>;
}

/** Шаблоны файлов чипами: подсказки типичных шаблонов добавляются нажатием, свой — клавишей Enter. */
function Patterns({ label, hint, hints, value, onChange, disabled }: { label: string; hint?: ReactNode; hints: string[]; value: string[]; onChange(next: string[]): void; disabled: boolean }) {
  const [draft, setDraft] = useState("");
  const add = (p: string) => { const t = p.trim(); if (t && !value.includes(t) && value.length < 50 && t.length <= 255) onChange([...value, t]); setDraft(""); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter добавляет шаблон и не отправляет всё действие.
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
