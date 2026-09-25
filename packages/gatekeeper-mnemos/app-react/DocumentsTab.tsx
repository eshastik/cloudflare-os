import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatCircleText, CircleNotch, FileArrowUp, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { DocumentContent, ProjectSearchPage } from "../src/mnemos-api.ts";
import { useHost, useUi } from "./host.ts";
import { documentRows, UNNAMED_DOCUMENT, type DocumentRow, type MemoryData } from "./data.ts";
import AdministrativeDocuments from "./AdministrativeDocuments.tsx";
import { folderOf, MaterialCard, queryTerms, MaterialChatButtons, materialPrompt, type MaterialAction } from "./MaterialCard.tsx";
import { isMarkdown, Markdown } from "./markdown.tsx";
import { relativeTime } from "./time.ts";
import { Button, Notice, StatusBadge } from "./ui.tsx";

/** Время документа даёт только история; чтобы не грузить сервер, берём первую страницу истории для ограниченного числа строк. */
const HISTORY_ROWS = 40;
const HISTORY_PARALLEL = 4;
/** Поиск идёт по каждому проекту отдельно: общего метода по всем проектам у приложения нет. */
const SEARCH_PARALLEL = 4;
/** Пауза после последней набранной буквы: поиск идёт сам, но не на каждое нажатие. */
export const SEARCH_DELAY_MS = 300;
/** Короче запрос не уходит: префикс из одной буквы совпадает почти со всем и ничего не сужает (сервер тоже его не ищет). */
export const MIN_QUERY_LENGTH = 2;
/** Сколько проектов видно сразу; остальные открываются кнопкой «Ещё». */
const VISIBLE_PROJECTS = 6;

type SearchHit = ProjectSearchPage["hits"][number];
type Opened = { row: DocumentRow; content: DocumentContent | null; error: string };
type Search = { query: string; hits: SearchHit[]; pending: boolean; failed: number; busy: boolean };

const keyOf = (projectId: string, nodeId: string) => `${projectId}/${nodeId}`;

/**
 * Ответы проектов сливаются по очереди: первый результат каждого проекта, затем вторые и так далее.
 * Оценки разных проектов сервер не сравнивает, поэтому ни один проект не вытесняет остальные.
 * Один документ показывается одной строкой — с первым найденным фрагментом.
 */
export function mergeHits(pages: SearchHit[][]): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...pages.map(p => p.length));
  for (let i = 0; i < longest; i++) {
    for (const page of pages) {
      const hit = page[i];
      if (!hit || seen.has(keyOf(hit.project_id, hit.node_id))) continue;
      seen.add(keyOf(hit.project_id, hit.node_id));
      out.push(hit);
    }
  }
  return out;
}

/** «Материалы»: поиск ищет сам при вводе, проект выбирается чипом, просмотр справа; вопрос и задача уводят в беседу. */
export default function DocumentsTab({ data, initialProject = "" }: { data: MemoryData; initialProject?: string }) {
  const ui = useUi();
  const host = useHost();
  const [administrative, setAdministrative] = useState(false);
  const [isAdministrator, setIsAdministrator] = useState(false);
  useEffect(() => {
    let current=true; setIsAdministrator(false);
    const user=data.identity?.subject.user_id;
    if(user) void ui.readPrincipalMembership("system:organization-admins",user).then(member=>{if(current)setIsAdministrator(member.enabled);},()=>{if(current)setIsAdministrator(false);});
    return ()=>{current=false;};
  },[ui,data.identity?.subject.user_id]);
  const [selected, setSelected] = useState(initialProject);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [allProjects, setAllProjects] = useState(false);
  const [times, setTimes] = useState<Map<string, string>>(new Map());
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const requested = useRef(new Set<string>());
  const searchGeneration = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { mounted.current = false; clearTimeout(timer.current); searchAbort.current?.abort(); }, []);

  const rowsByProject = useMemo(() => new Map(data.projects.map(p => [p.id, documentRows(p, data.reviews)])), [data.projects, data.reviews]);
  const visibleProjects = useMemo(() => selected ? data.projects.filter(p => p.id === selected) : data.projects, [data.projects, selected]);
  const rows = useMemo(() => visibleProjects.flatMap(p => rowsByProject.get(p.id) ?? []), [visibleProjects, rowsByProject]);
  const total = data.projects.reduce((sum, p) => sum + (rowsByProject.get(p.id)?.length ?? 0), 0);
  const anyTruncated = data.projects.some(p => p.truncated);
  // Эффект поиска читает проекты через ссылку: перезагрузка списка проектов не должна повторять запрос.
  const projectsRef = useRef(data.projects);
  projectsRef.current = data.projects;

  const loadTimes = useCallback((wanted: { projectId: string; nodeId: string }[]) => {
    const pending = wanted.slice(0, HISTORY_ROWS).filter(row => !requested.current.has(keyOf(row.projectId, row.nodeId)));
    if (!pending.length) return;
    for (const row of pending) requested.current.add(keyOf(row.projectId, row.nodeId));
    let next = 0;
    const worker = async () => {
      while (next < pending.length && mounted.current) {
        const row = pending[next++];
        try {
          const page = await ui.nodeHistory(row.projectId, row.nodeId, "");
          const at = page.events[0]?.recorded_at;
          if (at && mounted.current) setTimes(prev => new Map(prev).set(keyOf(row.projectId, row.nodeId), at));
        } catch { /* без времени строка остаётся полезной */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(HISTORY_PARALLEL, pending.length) }, worker));
  }, [ui]);

  useEffect(() => { loadTimes(rows); }, [rows, loadTimes]);
  useEffect(() => { if (search && !search.busy) loadTimes(search.hits.map(h => ({ projectId: h.project_id, nodeId: h.node_id }))); }, [search, loadTimes]);

  // Новый запрос отменяет прежний: по оставшимся проектам прежний запрос больше не уходит, а его ответы
  // отбрасываются. Уже отправленный вызов сервер доведёт до конца — вызов оболочки сигнала отмены не принимает.
  const runSearch = useCallback(async (text: string, projects: { id: string }[]) => {
    searchAbort.current?.abort();
    const abort = new AbortController();
    searchAbort.current = abort;
    const generation = ++searchGeneration.current;
    // Прежние результаты остаются на экране, пока идёт новый запрос: список не мигает на каждой букве.
    setSearch(prev => ({ query: text, hits: prev?.hits ?? [], pending: false, failed: 0, busy: true }));
    const pages: SearchHit[][] = new Array(projects.length);
    let pending = false, failed = 0, next = 0;
    const worker = async () => {
      while (next < projects.length && !abort.signal.aborted) {
        const index = next++;
        try {
          const page = await ui.searchProject(projects[index].id, text);
          if (abort.signal.aborted) return;
          pages[index] = page.hits; pending ||= page.index_pending;
        } catch { pages[index] = []; failed++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEARCH_PARALLEL, projects.length) }, worker));
    // Поздний ответ на прежний запрос не перекрывает новый.
    if (!mounted.current || abort.signal.aborted || generation !== searchGeneration.current) return;
    setSearch({ query: text, hits: mergeHits(pages), pending, failed, busy: false });
  }, [ui]);

  const scopeOf = (project: string) => project ? projectsRef.current.filter(p => p.id === project) : projectsRef.current;

  // Поиск идёт сам: пауза после ввода, смена проекта — сразу в новых границах.
  const lastProject = useRef(selected);
  useEffect(() => {
    clearTimeout(timer.current);
    const text = query.trim();
    if (text.length < MIN_QUERY_LENGTH) { searchAbort.current?.abort(); searchGeneration.current++; setSearch(null); lastProject.current = selected; return; }
    const delay = lastProject.current === selected ? SEARCH_DELAY_MS : 0;
    lastProject.current = selected;
    timer.current = setTimeout(() => { void runSearch(text, scopeOf(selected)); }, delay);
    return () => clearTimeout(timer.current);
  }, [query, selected, runSearch]);

  function searchNow() {
    const text = query.trim();
    if (text.length < MIN_QUERY_LENGTH) return;
    clearTimeout(timer.current);
    void runSearch(text, scopeOf(selected));
  }
  function clearQuery() { setQuery(""); input.current?.focus(); }

  async function open(row: DocumentRow) {
    setNotice("");
    setOpened({ row, content: null, error: "" });
    try {
      // Документ со своим редактором открывается в оболочке; просмотр здесь не нужен.
      if (await host.openNativeDocument(row.projectId, row.nodeId)) { setOpened(current => current?.row === row ? null : current); return; }
      let content: DocumentContent;
      if (row.privateOnly) {
        const doc = await ui.readDraftDocument(row.projectId, row.nodeId);
        if (!doc.exists) throw new Error("Документ больше не найден в личном черновике.");
        if (doc.conflicted || doc.terms.length !== 1 || !doc.terms[0].present) throw new Error("У документа конфликт версий. Откройте личный черновик, чтобы выбрать вариант.");
        if (!/^(text\/|application\/(json|xml|javascript|x-yaml|yaml)(;|$))/.test(doc.content_type ?? "")) throw new Error("Этот формат нельзя показать как текст. Откройте личный черновик для работы с файлом.");
        const text = await host.downloadText(row.projectId, row.nodeId, doc.head, 0);
        content = {node_id: row.nodeId, text, media_type: doc.content_type ?? "text/plain", truncated: false};
      } else {
        content = await ui.readProjectDocument(row.projectId, row.nodeId);
      }
      setOpened(current => current?.row === row ? { row, content, error: "" } : current);
    } catch (error) {
      const localMessage = error instanceof Error && /^(Документ больше|У документа конфликт|Этот формат)/.test(error.message) ? error.message : "Не удалось загрузить содержимое. Повторите попытку; если ошибка сохраняется, проверьте состояние подключения.";
      setOpened(current => current?.row === row ? { row, content: null, error: localMessage } : current);
    }
  }

  function chat(row: DocumentRow, action: MaterialAction) {
    setNotice("");
    // Недоступный проект в беседу не передаётся: агент всё равно не сможет его подключить.
    const known = data.projects.some(p => p.id === row.projectId);
    void host.openPrompt(materialPrompt(action, row.name), known ? { projectId: row.projectId, title: row.projectName } : undefined)
      .catch(() => setNotice("Беседа не открылась. Повторите попытку."));
  }

  function askAgent(text: string) {
    setNotice("");
    const project = data.projects.find(p => p.id === selected);
    void host.openPrompt(`Найди в материалах: ${text}`, project ? { projectId: project.id, title: project.name } : undefined)
      .catch(() => setNotice("Беседа не открылась. Повторите попытку."));
  }

  async function upload() {
    if (uploading) return;
    setUploading(true); setNotice("");
    try {
      const result = await (selected ? host.pickInboxFiles(false, selected) : host.pickInboxFiles(false));
      if (result.length) await data.reloadProjects();
    } catch { setNotice("Загрузка не завершена. Проверьте материалы проекта перед повтором."); }
    finally { setUploading(false); }
  }

  function rowFor(hit: SearchHit): DocumentRow {
    const known = rowsByProject.get(hit.project_id)?.find(r => r.nodeId === hit.node_id);
    if (known) return hit.name ? { ...known, name: hit.name } : known;
    const project = data.projects.find(p => p.id === hit.project_id);
    return { projectId: hit.project_id, projectName: project?.name ?? "проект, недоступный вам", nodeId: hit.node_id, name: hit.name || UNNAMED_DOCUMENT, status: { tone: "success", label: "Опубликовано" } };
  }

  const isOpened = (row: DocumentRow) => opened?.row.projectId === row.projectId && opened.row.nodeId === row.nodeId;
  const nodesFailed = visibleProjects.filter(p => p.nodesError);
  const noMaterials = rows.length === 0 && !data.projectsLoading && nodesFailed.length === 0 && !data.projectsError;
  const scopeName = selected ? data.projects.find(p => p.id === selected)?.name : "";
  const countOf = (id: string) => `${rowsByProject.get(id)?.length ?? 0}${data.projects.find(p => p.id === id)?.truncated ? "+" : ""}`;
  const shownProjects = allProjects || data.projects.length <= VISIBLE_PROJECTS + 1 ? data.projects
    : data.projects.filter((p, i) => i < VISIBLE_PROJECTS || p.id === selected);
  const hiddenProjects = data.projects.length - shownProjects.length;
  const terms = useMemo(() => search ? queryTerms(search.query) : [], [search?.query]);
  const materialRow = (row: DocumentRow, fragment?: string, folder?: string) => (
    <MaterialCard key={keyOf(row.projectId, row.nodeId)} row={row} fragment={fragment} folder={folder ?? row.folder} terms={search ? terms : undefined}
      showProject={!selected} at={times.get(keyOf(row.projectId, row.nodeId))}
      selected={isOpened(row)} onOpen={() => void open(row)} onChat={action => chat(row, action)} />
  );

  return (
    <div className="max-w-[1040px]">
      <div className="sticky top-0 z-10 -mx-1 bg-kumo-base px-1 pt-1 pb-3">
        <label className="flex h-12 items-center gap-3 rounded-[16px] border border-kumo-fill bg-kumo-overlay px-4 text-kumo-subtle shadow-[0_1px_2px_rgba(24,32,28,.04)] focus-within:border-kumo-brand">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <input ref={input} type="search" value={query} autoComplete="off" spellCheck={false}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchNow(); } else if (e.key === "Escape" && query) { e.preventDefault(); clearQuery(); } }}
            placeholder={scopeName ? `Искать в «${scopeName}»: имя файла, слово, вопрос` : "Искать во всех материалах: имя файла, слово, вопрос"}
            aria-label="Поиск по материалам"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-kumo-default outline-none placeholder:text-kumo-inactive [&::-webkit-search-cancel-button]:hidden" />
          <span aria-live="polite" className="shrink-0 text-[13px]">
            {search?.busy && <span data-searching="" className="inline-flex items-center gap-1.5 text-kumo-subtle"><CircleNotch size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Ищу…</span>}
          </span>
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && <span data-too-short="" className="shrink-0 text-[13px] text-kumo-subtle">Ещё хотя бы один знак</span>}
          {query && <button type="button" aria-label="Очистить поиск" onClick={clearQuery}
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-kumo-subtle outline-none hover:bg-kumo-tint hover:text-kumo-default focus-visible:ring-2 focus-visible:ring-kumo-ring"><X size={14} aria-hidden="true" /></button>}
        </label>

        {data.projects.length > 1 && (
          <div role="group" aria-label="Проект" className="mt-3 flex flex-wrap items-center gap-1.5">
            <ProjectChip active={!selected} onClick={() => setSelected("")} count={`${total}${anyTruncated ? "+" : ""}`}>Все проекты</ProjectChip>
            {shownProjects.map(p => <ProjectChip key={p.id} active={selected === p.id} onClick={() => setSelected(p.id)} count={countOf(p.id)}>{p.name}</ProjectChip>)}
            {hiddenProjects > 0 && <button type="button" onClick={() => setAllProjects(true)} className="h-8 rounded-full px-3 text-[13px] text-kumo-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-kumo-ring">Ещё {hiddenProjects}</button>}
          </div>
        )}
      </div>

      {notice && <div className="mb-3"><Notice tone="danger">{notice}</Notice></div>}
      {data.projectsError && <div className="mb-3"><Notice tone="danger">{data.projectsError}</Notice></div>}

      <div className={opened ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]" : ""}>
        <div className="min-w-0">
          {search ? (
            <section aria-label="Результаты поиска" aria-busy={search.busy || undefined}>
              {(search.busy || search.hits.length > 0 || search.pending || search.failed > 0) && <ListHeader>
                {search.busy && search.hits.length === 0 ? `Ищу «${search.query}»…` : `Найдено: ${search.hits.length}`}
                {search.pending && <span> · часть файлов ещё готовится к поиску</span>}
                {search.failed > 0 && <span className="text-kumo-danger"> · не ответили проекты: {search.failed} <button type="button" onClick={searchNow} className="text-kumo-brand underline-offset-2 hover:underline">Повторить</button></span>}
              </ListHeader>}
              {!search.busy && search.hits.length === 0 && <NothingFound query={search.query} scope={scopeName} onAsk={() => askAgent(search.query)} />}
              {search.hits.length > 0 && <div className={`overflow-hidden rounded-[16px] border border-kumo-fill bg-kumo-overlay transition-opacity ${search.busy ? "opacity-60" : ""}`}>
                {search.hits.map(hit => {
                  const row = rowFor(hit);
                  return materialRow(row, hit.text, hit.path !== undefined ? folderOf(hit.path, hit.name) : row.folder);
                })}
              </div>}
            </section>
          ) : (
            <section aria-label="Документы">
              {nodesFailed.length > 0 && <div className="mb-3"><Notice tone="danger">Не удалось загрузить документы: {nodesFailed.map(p => p.name).join(", ")}. Проверьте доступ и обновите страницу.</Notice></div>}
              {rows.length === 0 && data.projectsLoading && <p className="m-0 py-8 text-center text-[14px] text-kumo-subtle">Загружаю материалы…</p>}
              {noMaterials && <EmptyMaterials inProject={!!selected} uploading={uploading} onUpload={() => void upload()} />}
              {rows.length > 0 && <>
                <ListHeader>{scopeName ? `В проекте «${scopeName}»: ${rows.length}` : `Все материалы: ${rows.length}`}{anyTruncated && " · показана первая страница, остальное находится поиском"}</ListHeader>
                <div className="overflow-hidden rounded-[16px] border border-kumo-fill bg-kumo-overlay">{rows.map(row => materialRow(row))}</div>
              </>}
            </section>
          )}
        </div>

        {opened && (
          <aside aria-label="Просмотр документа" className="min-w-0 rounded-[20px] border border-kumo-fill bg-kumo-overlay p-5 shadow-[0_1px_2px_rgba(24,32,28,.05),0_16px_40px_rgba(24,32,28,.08)] max-lg:order-first lg:sticky lg:top-24 lg:self-start">
            <div className="mb-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-[17px] font-semibold tracking-[-0.2px] text-kumo-default [overflow-wrap:anywhere]">{opened.row.name}</h2>
                <p className="mt-0.5 mb-0 text-[13px] text-kumo-subtle">
                  {opened.row.projectName}{times.get(keyOf(opened.row.projectId, opened.row.nodeId)) && <>, изменён {relativeTime(times.get(keyOf(opened.row.projectId, opened.row.nodeId))!)}</>}
                </p>
              </div>
              <Button variant="ghost" size="sm" shape="square" icon={X} aria-label="Закрыть просмотр" onClick={() => setOpened(null)} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-1">
              {opened.row.status.tone !== "success" && <StatusBadge tone={opened.row.status.tone}>{opened.row.status.label}</StatusBadge>}
              <MaterialChatButtons onChat={action => chat(opened.row, action)} />
            </div>
            <div className="max-h-[68vh] overflow-auto rounded-[12px] bg-kumo-base p-4">
              {opened.error && <div className="space-y-2"><Notice tone="danger">{opened.error}</Notice><Button variant="secondary" size="sm" onClick={() => void open(opened.row)}>Повторить загрузку</Button></div>}
              {!opened.error && !opened.content && <p className="m-0 text-[14px] text-kumo-subtle">Загружаю…</p>}
              {opened.content && (opened.content.text && isMarkdown(opened.content.media_type, opened.row.name)
                ? <Markdown text={opened.content.text} className="text-[14px] leading-5 text-kumo-default" />
                : <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-kumo-default">{opened.content.text || "(Пустой файл)"}</pre>)}
              {opened.content?.truncated && <p className="mt-3 mb-0 text-[13px] text-kumo-subtle">Показано начало документа: он длиннее допустимого для просмотра.</p>}
            </div>
          </aside>
        )}
      </div>
      {isAdministrator && <details aria-label="Личные версии сотрудников" className="mt-8 border-t border-kumo-fill pt-4" onToggle={e => setAdministrative((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-[15px] font-semibold text-kumo-default">Личные версии сотрудников</summary>
        <p className="mt-1 mb-0 text-[13px] text-kumo-subtle">Черновики, которые сотрудники ещё не опубликовали. Видны только администратору.</p>
        {administrative && <div className="mt-3"><AdministrativeDocuments data={data} initialProject={selected} /></div>}
      </details>}
    </div>
  );
}

function ListHeader({ children }: { children: ReactNode }) {
  return <p className="m-0 mb-2 px-1 text-[13px] leading-5 text-kumo-subtle">{children}</p>;
}

/** Чип проекта: активный залит акцентом, счётчик материалов приглушён. */
function ProjectChip({ active, count, onClick, children }: { active: boolean; count: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`inline-flex h-8 max-w-[280px] items-center gap-1.5 rounded-full border px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-kumo-ring ${active ? "border-kumo-brand bg-kumo-brand text-white" : "border-kumo-fill bg-kumo-overlay text-kumo-default hover:bg-kumo-tint"}`}>
      <span className="truncate">{children}</span>
      <span className={`tabular-nums ${active ? "text-white/75" : "text-kumo-subtle"}`}>{count}</span>
    </button>
  );
}

/** Пустой результат: что искали и где, и следующий шаг — спросить агента, он ищет шире. */
function NothingFound({ query, scope, onAsk }: { query: string; scope?: string; onAsk(): void }) {
  return (
    <div data-nothing-found="" className="flex flex-col items-center gap-2 rounded-[16px] border border-kumo-fill bg-kumo-overlay px-6 py-8 text-center">
      <h2 className="m-0 text-[15px] font-semibold text-kumo-default">Ничего не найдено по «{query}»{scope ? ` в «${scope}»` : ""}</h2>
      <p className="m-0 max-w-[440px] text-[14px] leading-5 text-kumo-subtle">Проверьте написание или попробуйте часть имени файла. Агент в беседе ищет шире и по смыслу.</p>
      <Button size="sm" variant="secondary" icon={ChatCircleText} onClick={onAsk} className="mt-1">Спросить агента</Button>
    </div>
  );
}

/** Пустое состояние подсказывает первое действие: файлы кладут в беседу или загружают здесь. */
function EmptyMaterials({ inProject, uploading, onUpload }: { inProject: boolean; uploading: boolean; onUpload(): void }) {
  return (
    <div data-empty-materials="" className="flex flex-col items-center gap-3 rounded-[16px] border border-dashed border-kumo-fill-hover px-6 py-8 text-center">
      <FileArrowUp size={28} className="text-kumo-subtle" aria-hidden="true" />
      <div>
        <h2 className="m-0 text-[15px] font-semibold text-kumo-default">{inProject ? "В этом проекте пока нет материалов" : "Материалов пока нет"}</h2>
        <p className="mt-1 mb-0 max-w-[460px] text-[14px] leading-5 text-kumo-subtle">Перетащите файлы в беседу — агент предложит, куда их положить. Или загрузите их здесь.</p>
      </div>
      <Button size="sm" disabled={uploading} onClick={onUpload}>{uploading ? "Загружаю…" : "Загрузить файлы"}</Button>
    </div>
  );
}
