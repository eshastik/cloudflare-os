import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@cloudflare/kumo";
import { FileArrowUp, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { DocumentContent, ProjectSearchPage } from "../src/mnemos-api.ts";
import { useHost, useUi } from "./host.ts";
import { documentRows, UNNAMED_DOCUMENT, type DocumentRow, type MemoryData } from "./data.ts";
import { LegacyPanel } from "./legacy.tsx";
import AdministrativeDocuments from "./AdministrativeDocuments.tsx";
import { MaterialCard, MaterialChatButtons, materialPrompt, type MaterialAction } from "./MaterialCard.tsx";
import { relativeTime } from "./time.ts";
import { Notice, Select, StatusBadge } from "./ui.tsx";

/** Время документа даёт только история; чтобы не грузить сервер, берём первую страницу истории для ограниченного числа карточек. */
const HISTORY_ROWS = 40;
const HISTORY_PARALLEL = 4;
/** Поиск идёт по каждому проекту отдельно: общего метода по всем проектам у приложения нет. */
const SEARCH_PARALLEL = 4;

type SearchHit = ProjectSearchPage["hits"][number];
type Opened = { row: DocumentRow; content: DocumentContent | null; error: string };
type Search = { query: string; hits: SearchHit[]; pending: boolean; failed: number; busy: boolean };

const keyOf = (projectId: string, nodeId: string) => `${projectId}/${nodeId}`;

/**
 * Ответы проектов сливаются по очереди: первый результат каждого проекта, затем вторые и так далее.
 * Оценки разных проектов сервер не сравнивает, поэтому ни один проект не вытесняет остальные.
 * Один документ показывается одной карточкой — с первым найденным фрагментом.
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

/** «Материалы»: поиск по всему доступному, карточки, просмотр справа; вопрос и задача по документу уводят в беседу. */
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
  const [times, setTimes] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const requested = useRef(new Set<string>());
  const searchGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const rowsByProject = useMemo(() => new Map(data.projects.map(p => [p.id, documentRows(p, data.reviews)])), [data.projects, data.reviews]);
  const visibleProjects = useMemo(() => selected ? data.projects.filter(p => p.id === selected) : data.projects, [data.projects, selected]);
  const rows = useMemo(() => visibleProjects.flatMap(p => rowsByProject.get(p.id) ?? []), [visibleProjects, rowsByProject]);
  const total = data.projects.reduce((sum, p) => sum + (rowsByProject.get(p.id)?.length ?? 0), 0);
  const anyTruncated = data.projects.some(p => p.truncated);

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
        } catch { /* без времени карточка остаётся полезной */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(HISTORY_PARALLEL, pending.length) }, worker));
  }, [ui]);

  useEffect(() => { loadTimes(rows); }, [rows, loadTimes]);
  useEffect(() => { if (search && !search.busy) loadTimes(search.hits.map(h => ({ projectId: h.project_id, nodeId: h.node_id }))); }, [search, loadTimes]);

  const runSearch = useCallback(async (text: string, projects: { id: string }[]) => {
    const generation = ++searchGeneration.current;
    setSearch({ query: text, hits: [], pending: false, failed: 0, busy: true });
    const pages: SearchHit[][] = new Array(projects.length);
    let pending = false, failed = 0, next = 0;
    const worker = async () => {
      while (next < projects.length) {
        const index = next++;
        try {
          const page = await ui.searchProject(projects[index].id, text);
          pages[index] = page.hits; pending ||= page.index_pending;
        } catch { pages[index] = []; failed++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEARCH_PARALLEL, projects.length) }, worker));
    // Поздний ответ на прежний запрос не перекрывает новый.
    if (!mounted.current || generation !== searchGeneration.current) return;
    setSearch({ query: text, hits: mergeHits(pages), pending, failed, busy: false });
  }, [ui]);

  // Смена проекта при активном поиске повторяет тот же запрос в новых границах.
  // Реакция только на выбор: список проектов меняется и во время загрузки, повторять поиск на это не нужно.
  function selectProject(project: string) {
    setSelected(project);
    if (search) void runSearch(search.query, project ? data.projects.filter(p => p.id === project) : data.projects);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) { clearSearch(); return; }
    void runSearch(text, visibleProjects);
  }
  function clearSearch() { searchGeneration.current++; setSearch(null); setQuery(""); }

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

  if (administrative) return <AdministrativeDocuments data={data} initialProject={selected} onClose={()=>setAdministrative(false)} />;

  if (opened && editing) return <LegacyPanel section={{kind: "document", project: opened.row.projectId, node: opened.row.nodeId}} title={opened.row.name} onClose={() => { setEditing(false); void data.reloadProjects(); }} />;

  const isOpened = (row: DocumentRow) => opened?.row.projectId === row.projectId && opened.row.nodeId === row.nodeId;
  const nodesFailed = visibleProjects.filter(p => p.nodesError);
  const noMaterials = rows.length === 0 && !data.projectsLoading && nodesFailed.length === 0 && !data.projectsError;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={submitSearch} role="search" className="flex min-w-[240px] flex-1 items-center gap-2">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-kumo-line bg-kumo-base px-3 text-kumo-inactive focus-within:border-kumo-ring">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти в материалах: слова, тема или вопрос…" aria-label="Поиск по материалам"
              className="w-full bg-transparent text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default outline-none placeholder:text-kumo-inactive" />
          </label>
          <Button type="submit" variant="secondary" disabled={search?.busy}>Найти</Button>
          {search && <Button type="button" variant="ghost" onClick={clearSearch}>Очистить</Button>}
        </form>
        <Select aria-label="Проект" value={selected} onChange={e => selectProject(e.target.value)} className="h-9 max-w-[260px]">
          <option value="">{`Все проекты · ${total}${anyTruncated ? "+" : ""}`}</option>
          {data.projects.map(p => <option key={p.id} value={p.id}>{`${p.name} · ${rowsByProject.get(p.id)?.length ?? 0}${p.truncated ? "+" : ""}`}</option>)}
        </Select>
        {isAdministrator && <Button variant="ghost" size="sm" onClick={()=>setAdministrative(true)}>Личные версии сотрудников</Button>}
      </div>

      {notice && <div className="mb-2"><Notice tone="danger">{notice}</Notice></div>}
      {data.projectsError && <div className="mb-2"><Notice tone="danger">{data.projectsError}</Notice></div>}

      <div className={opened ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]" : ""}>
        <div className="min-w-0">
          {search ? (
            <section aria-label="Результаты поиска">
              <p className="m-0 mb-2 text-[12px] text-kumo-subtle">
                {search.busy ? "Ищем…" : `Найдено: ${search.hits.length}`}
                {search.pending && " · поиск ещё обновляется, часть документов может не найтись"}
                {search.failed > 0 && ` · не удалось проверить проектов: ${search.failed}`}
              </p>
              {!search.busy && search.hits.length === 0 && <Notice>По запросу «{search.query}» ничего не найдено. Попробуйте другие слова или спросите в беседе — агент поищет шире.</Notice>}
              {search.hits.length > 0 && <div className="grid gap-3">
                {search.hits.map(hit => {
                  const row = rowFor(hit);
                  return <MaterialCard key={keyOf(hit.project_id, hit.node_id)} row={row} fragment={hit.text} at={times.get(keyOf(row.projectId, row.nodeId))}
                    selected={isOpened(row)} onOpen={() => void open(row)} onChat={action => chat(row, action)} />;
                })}
              </div>}
            </section>
          ) : (
            <section aria-label="Документы">
              {nodesFailed.length > 0 && <div className="mb-2"><Notice tone="danger">Не удалось загрузить документы: {nodesFailed.map(p => p.name).join(", ")}. Проверьте доступ и обновите страницу.</Notice></div>}
              {rows.length === 0 && data.projectsLoading && <Notice>Загрузка…</Notice>}
              {noMaterials && <EmptyMaterials inProject={!!selected} uploading={uploading} onUpload={() => void upload()} />}
              {rows.length > 0 && <div className="grid gap-3">
                {rows.map(row => <MaterialCard key={keyOf(row.projectId, row.nodeId)} row={row} at={times.get(keyOf(row.projectId, row.nodeId))}
                  selected={isOpened(row)} onOpen={() => void open(row)} onChat={action => chat(row, action)} />)}
              </div>}
              {anyTruncated && <p className="mt-2 mb-0 text-[12px] text-kumo-subtle">Показана первая страница документов каждого проекта. Остальное находится поиском.</p>}
            </section>
          )}
        </div>

        {opened && (
          <aside aria-label="Просмотр документа" className="min-w-0 rounded-xl border border-kumo-line bg-kumo-base p-4 max-lg:order-first lg:sticky lg:top-4 lg:self-start">
            <div className="mb-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-[15px] font-semibold text-kumo-strong [overflow-wrap:anywhere]">{opened.row.name}</h2>
                <p className="mt-0.5 mb-0 text-[12px] text-kumo-subtle">
                  {opened.row.projectName}{times.get(keyOf(opened.row.projectId, opened.row.nodeId)) && <> · изменён {relativeTime(times.get(keyOf(opened.row.projectId, opened.row.nodeId))!)}</>}
                </p>
              </div>
              <Button variant="ghost" size="sm" shape="square" icon={X} aria-label="Закрыть просмотр" onClick={() => setOpened(null)} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge tone={opened.row.status.tone}>{opened.row.status.label}</StatusBadge>
              <MaterialChatButtons onChat={action => chat(opened.row, action)} />
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Открыть личный черновик</Button>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-kumo-line bg-kumo-elevated p-3">
              {opened.error && <div className="space-y-2"><Notice tone="danger">{opened.error}</Notice><Button variant="secondary" size="sm" onClick={() => void open(opened.row)}>Повторить загрузку</Button></div>}
              {!opened.error && !opened.content && <Notice>Загрузка…</Notice>}
              {opened.content && <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">{opened.content.text || "(Пустой файл)"}</pre>}
              {opened.content?.truncated && <p className="mt-3 mb-0 text-[12px] text-kumo-subtle">Показано начало документа: он длиннее допустимого для просмотра.</p>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** Пустое состояние подсказывает первое действие: файлы кладут в беседу или загружают здесь. */
function EmptyMaterials({ inProject, uploading, onUpload }: { inProject: boolean; uploading: boolean; onUpload(): void }) {
  return (
    <div data-empty-materials="" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-kumo-line bg-kumo-base px-6 py-10 text-center">
      <FileArrowUp size={28} className="text-kumo-subtle" aria-hidden="true" />
      <div>
        <h2 className="m-0 text-[15px] font-semibold text-kumo-strong">{inProject ? "В этом проекте пока нет материалов" : "Материалов пока нет"}</h2>
        <p className="mt-1 mb-0 max-w-[460px] text-[13px] leading-[18px] text-kumo-subtle">Перетащите файлы в беседу — агент предложит, куда их положить. Или загрузите их здесь.</p>
      </div>
      <Button variant="primary" size="sm" disabled={uploading} onClick={onUpload}>{uploading ? "Загружаем…" : "Загрузить файлы"}</Button>
    </div>
  );
}
