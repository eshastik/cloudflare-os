import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatCircleText, CircleNotch, FileArrowUp, MagnifyingGlass, X, Folder, ArrowLeft, CaretRight } from "@phosphor-icons/react";
import type { DocumentContent, ProjectSearchPage } from "../src/mnemos-api.ts";
import { useHost, useUi } from "./host.ts";
import { documentRows, isPersonalSpace, UNNAMED_DOCUMENT, type DocumentRow, type MemoryData, type ProjectNode, type ProjectData } from "./data.ts";
import { ProjectConversations, ExplorerFolders, ExplorerPath, ExplorerAssistant, explorerPrompt, inFolder, folderPath, type ExplorerTarget } from "./ProjectExplorer.tsx";
import AdministrativeDocuments from "./AdministrativeDocuments.tsx";
import { folderOf, MaterialCard, queryTerms, MaterialChatButtons, materialPrompt, type MaterialAction, type MoveTarget, type MoveTargets } from "./MaterialCard.tsx";
import { isMarkdown, Markdown } from "./markdown.tsx";
import { relativeTime } from "./time.ts";
import { Button, Notice, PageHeader, StatusBadge, touchOnly } from "./ui.tsx";

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
type Opened = { row: DocumentRow; content: DocumentContent | null; error: string; textHead?: string };
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
export default function DocumentsTab({ data, initialProject = "", linkedDocument = null }: { data: MemoryData; initialProject?: string; linkedDocument?: { node: string; seq: number } | null }) {
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
  const selectedFromList = useRef("");
  useEffect(() => {
    // Выбор файла меняет адрес, но сохраняет текущий список и поиск рядом с просмотром.
    const fromList = linkedDocument && selectedFromList.current === keyOf(initialProject, linkedDocument.node);
    selectedFromList.current = "";
    if (!fromList) setSelected(initialProject);
  }, [initialProject, linkedDocument]);
  const [tab, setTab] = useState<"files" | "chats">("files");
  const [folder, setFolder] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [nodePage, setNodePage] = useState<{ project: string; nodes: ProjectNode[]; cursor: string; truncated: boolean } | null>(null);
  const [extraPrivate, setExtraPrivate] = useState<{ project: string; docs: ProjectData["privateDocs"]; cursor: string } | null>(null);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const scannedCursors = useRef(new Set<string>());
  const pageGeneration = useRef(0);
  const previousProject = useRef("");
  const baseNodes = data.projects.find(project => project.id === selected)?.nodes;
  useEffect(() => {
    const generation = ++pageGeneration.current;
    scannedCursors.current.clear();
    if (previousProject.current !== selected) { setFolder(""); setChosen(new Set()); previousProject.current = selected; }
    setNodePage(null); setExtraPrivate(null);
    if (!selected) return;
    setLoadingNodes(true);
    void ui.browseProject(selected, "").then(page => {
      if (pageGeneration.current === generation) setNodePage({ project: selected, nodes: page.nodes, cursor: page.next_cursor ?? "", truncated: page.truncated });
    }, () => { if (pageGeneration.current === generation) setNotice("Не удалось прочитать папки проекта. Повторите загрузку."); }).finally(() => { if (pageGeneration.current === generation) setLoadingNodes(false); });
    return () => { pageGeneration.current++; };
  }, [ui, selected, baseNodes]);
  async function moreNodes() {
    const sharedCursor = nodePage?.cursor ?? "", privateCursor = extraPrivate?.project === selected ? extraPrivate.cursor : data.projects.find(project => project.id === selected)?.privateCursor ?? "";
    if (loadingNodes || (!sharedCursor && !privateCursor)) return;
    const generation = pageGeneration.current, before = nodePage;
    setLoadingNodes(true); setNotice("");
    try {
      if (sharedCursor && before) {
        const page = await ui.browseProject(before.project, sharedCursor);
        if (page.next_cursor === sharedCursor) throw new Error("Сервер повторил страницу.");
        if (generation === pageGeneration.current) setNodePage({ project: before.project, nodes: [...new Map([...before.nodes, ...page.nodes].map(node => [node.node_id, node])).values()], cursor: page.next_cursor ?? "", truncated: page.truncated });
      }
      if (privateCursor) {
        const page = await ui.listPrivateDocuments(selected, privateCursor);
        if (page.next_cursor === privateCursor) throw new Error("Сервер повторил страницу.");
        if (generation === pageGeneration.current) setExtraPrivate(previous => ({ project: selected, docs: new Map([...(previous?.project === selected ? previous.docs : new Map()), ...page.documents.map(doc => [doc.node_id, { name: doc.name, parentId: doc.parent_id, contentType: doc.content_type, conflicted: doc.conflicted }] as const)]), cursor: page.next_cursor }));
      }
    } catch { if (generation === pageGeneration.current) setNotice("Продолжение списка не загрузилось. Повторите попытку. Если личная версия изменилась, обновите страницу."); }
    finally { if (generation === pageGeneration.current) setLoadingNodes(false); }
  }
  const explorerProjects = useMemo(() => data.projects.map(project => ({ ...project, ...(nodePage?.project === project.id ? { nodes: nodePage.nodes, truncated: nodePage.truncated } : {}), ...(extraPrivate?.project === project.id ? { privateDocs: new Map([...project.privateDocs, ...extraPrivate.docs]), privateCursor: extraPrivate.cursor } : {}) })), [data.projects, nodePage, extraPrivate]);
  const currentProject = explorerProjects.find(project => project.id === selected);
  const nodes = useMemo(() => currentProject ? [...currentProject.nodes, ...[...currentProject.privateDocs].filter(([id]) => !currentProject.nodes.some(node => node.node_id === id)).map(([id, doc]) => ({ node_id: id, parent_id: doc.parentId, name: doc.name, is_dir: false }))] : [], [currentProject]);
  const toggleChosen = (id: string) => setChosen(before => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  function openFolder(id: string) {
    setTab("files"); setFolder(id); setChosen(new Set()); setQuery(""); setOpened(null);
    void host.openSection("documents", selected, id || undefined).catch(() => setNotice("Не удалось сохранить переход к папке."));
  }
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [allProjects, setAllProjects] = useState(false);
  const [times, setTimes] = useState<Map<string, string>>(new Map());
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState("");
  const [moved, setMoved] = useState("");
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [readingMore, setReadingMore] = useState(false);
  const openedLink = useRef<number | null>(null);
  const requested = useRef(new Set<string>());
  const searchGeneration = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { mounted.current = false; clearTimeout(timer.current); searchAbort.current?.abort(); }, []);

  const rowsByProject = useMemo(() => new Map(explorerProjects.map(p => [p.id, documentRows(p, data.reviews)])), [explorerProjects, data.reviews]);
  const visibleProjects = useMemo(() => selected ? explorerProjects.filter(p => p.id === selected) : explorerProjects, [explorerProjects, selected]);
  const allRows = useMemo(() => visibleProjects.flatMap(p => rowsByProject.get(p.id) ?? []), [visibleProjects, rowsByProject]);
  const rows = selected ? allRows.filter(row => inFolder(nodes, row.nodeId, folder)).sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true })) : allRows;
  const shownFolders = selected ? nodes.filter(node => node.is_dir && inFolder(nodes, node.node_id, folder)).sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true })) : [];
  const targets: ExplorerTarget[] = nodes.filter(node => chosen.has(node.node_id)).map(node => ({ nodeId: node.node_id, name: folderPath(nodes, node.is_dir ? node.node_id : node.parent_id ?? "").map(n => n.name).concat(node.is_dir ? [] : [node.name]).join("/"), folder: node.is_dir, privateOnly: currentProject?.privateDocs.has(node.node_id) && !currentProject.nodes.some(shared => shared.node_id === node.node_id) }));
  for (const row of allRows) if (chosen.has(row.nodeId) && !targets.some(target => target.nodeId === row.nodeId)) targets.push({ nodeId: row.nodeId, name: row.name, privateOnly: row.privateOnly });
  const agentTargets = targets.length ? targets : folder ? [{ nodeId: folder, name: folderPath(nodes, folder).map(n => n.name).join("/"), folder: true }] : [];
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
      if (await host.openNativeDocument(row.projectId, row.nodeId, nodes.find(node => node.node_id === row.nodeId)?.parent_id || undefined)) { setOpened(current => current?.row === row ? null : current); return; }
      if (selected) { await download(row, true); setOpened(null); return; }
      let content: DocumentContent, textHead: string | undefined;
      if (row.privateOnly) {
        const doc = await ui.readDraftDocument(row.projectId, row.nodeId);
        if (!doc.exists) throw new Error("Документ больше не найден в личном черновике.");
        if (doc.conflicted || doc.terms.length !== 1 || !doc.terms[0].present) throw new Error("У документа конфликт версий. Откройте личный черновик, чтобы выбрать вариант.");
        const page = await ui.readDraftText(row.projectId, row.nodeId, 0, 262144);
        if (page.head !== doc.head) throw new Error("Документ изменился. Откройте его заново.");
        if (page.failure && !page.text) throw new Error("Не удалось извлечь текст. Исходный файл можно скачать.");
        if (page.failure) setNotice("Текст извлечён с предупреждением. Для проверки скачайте оригинал.");
        textHead = page.head;
        content = {node_id: row.nodeId, text: page.text, media_type: page.content_type, truncated: page.truncated,
          offset: page.offset, next_offset: page.next_offset, total_bytes: page.total_bytes, text_state: page.no_text ? "no_text" : "ready"};
      } else {
        content = await ui.readProjectDocument(row.projectId, row.nodeId);
      }
      setOpened(current => current?.row === row ? { row, content, error: "", textHead } : current);
    } catch (error) {
      const localMessage = error instanceof Error && /^(Документ больше|Документ изменился|У документа конфликт|Не удалось извлечь)/.test(error.message) ? error.message : "Не удалось загрузить содержимое. Повторите попытку; если ошибка сохраняется, проверьте состояние подключения.";
      setOpened(current => current?.row === row ? { row, content: null, error: localMessage } : current);
    }
  }

  function selectDocument(row: DocumentRow) {
    if (!selected) {
      void open(row);
      return;
    }
    void (async () => {
      if (await host.openNativeDocument(row.projectId, row.nodeId, nodes.find(node => node.node_id === row.nodeId)?.parent_id || undefined)) return;
      await download(row, true);
    })().catch(() => setNotice("Документ не открылся. Повторите попытку."));
  }

  function closeDocument() {
    setOpened(null);
    void host.openSection("documents", selected, folder || undefined)
      .catch(() => setNotice("Не удалось закрыть просмотр. Повторите попытку."));
  }

  useEffect(() => {
    if (!linkedDocument) { openedLink.current = null; setOpened(null); setFolder(""); return; }
    if (openedLink.current === linkedDocument.seq || data.projectsLoading) return;
    const project = explorerProjects.find(p => p.id === initialProject);
    if (!project) return;
    const linkedNode = nodes.find(node => node.node_id === linkedDocument.node);
    if (linkedNode?.is_dir) { openedLink.current = linkedDocument.seq; setFolder(linkedNode.node_id); setOpened(null); return; }
    if (!linkedNode && loadingNodes) return;
    const linkedCursor = nodePage?.cursor || project.privateCursor;
    if (!linkedNode && linkedCursor) { if (!scannedCursors.current.has(linkedCursor)) { scannedCursors.current.add(linkedCursor); void moreNodes(); } return; }
    if (linkedNode) setFolder(linkedNode.parent_id && nodes.some(node => node.node_id === linkedNode.parent_id && node.is_dir) ? linkedNode.parent_id : "");
    const hit = search?.hits.find(h => h.project_id === initialProject && h.node_id === linkedDocument.node);
    const row = rowsByProject.get(initialProject)?.find(r => r.nodeId === linkedDocument.node) ??
      (hit ? rowFor(hit) : { projectId: initialProject, projectName: project.name, nodeId: linkedDocument.node,
        name: UNNAMED_DOCUMENT, status: { tone: "success" as const, label: "Опубликовано" } });
    openedLink.current = linkedDocument.seq;
    void open(row);
  }, [linkedDocument, initialProject, rowsByProject, data.projectsLoading, explorerProjects, search, loadingNodes, nodePage, extraPrivate, nodes]);

  async function readMore() {
    const before = opened, content = before?.content;
    if (!before || !content?.truncated || readingMore || !content.next_offset) return;
    setReadingMore(true); setNotice("");
    try {
      let page: DocumentContent;
      const row = before.row;
      if (row.privateOnly) {
        const next = await ui.readDraftText(row.projectId, row.nodeId, content.next_offset, 262144);
        if (next.head !== before.textHead) throw new Error("Документ изменился. Откройте его заново.");
        if (next.failure && !next.text) throw new Error("Продолжение не прочитано. Исходный файл можно скачать.");
        if (next.failure) setNotice("Текст извлечён с предупреждением. Для проверки скачайте оригинал.");
        page = {node_id: row.nodeId, text: next.text, media_type: next.content_type, truncated: next.truncated,
          offset: next.offset, next_offset: next.next_offset, total_bytes: next.total_bytes};
      } else {
        page = await ui.readProjectDocumentPage(row.projectId, row.nodeId, content.next_offset, content.revision!);
        if (page.revision !== content.revision) throw new Error("Документ изменился. Откройте его заново.");
      }
      setOpened(current => current === before ? { ...before, content: { ...page, text: content.text + page.text, offset: content.offset ?? 0 } } : current);
    } catch (error) {
      setNotice(error instanceof Error && /^(Документ изменился|Продолжение не прочитано)/.test(error.message) ? error.message : "Продолжение не загрузилось. Повторите попытку или откройте документ заново.");
    } finally { setReadingMore(false); }
  }

  const originalGeneration = useRef(0);
  async function download(row: DocumentRow, previewOriginal = false) {
    if (downloading && !previewOriginal) return;
    const generation = previewOriginal ? ++originalGeneration.current : 0;
    setDownloading(true); setNotice("");
    try {
      let version: string;
      if (row.privateOnly) {
        if (opened?.row === row && opened.textHead) {
          version = "private:" + opened.textHead;
        } else {
          const doc = await ui.readDraftDocument(row.projectId, row.nodeId);
          if (!doc.exists || doc.conflicted || doc.terms.length !== 1 || !doc.terms[0].present) throw new Error("Личная версия недоступна или содержит конфликт.");
          version = "private:" + doc.head;
        }
      } else {
        const event = (await ui.nodeHistory(row.projectId, row.nodeId, "")).events[0];
        if (!event?.exists) throw new Error("Опубликованная версия недоступна.");
        version = "file-publication:" + event.event_id;
      }
      if (previewOriginal && generation !== originalGeneration.current) return;
      if (previewOriginal) await host.previewFile(row.projectId, row.nodeId, version, row.name, row.projectName);
      else await host.downloadFile(row.projectId, row.nodeId, version, row.name);
    } catch {
      if (previewOriginal && generation !== originalGeneration.current) return;
      setNotice(`Файл «${row.name}» ${previewOriginal ? "не открылся" : "не скачан"}. Проверьте доступ и повторите попытку. Если у личной версии конфликт, сначала выберите нужный вариант.`);
    } finally { if (!previewOriginal || generation === originalGeneration.current) setDownloading(false); }
  }

  function chat(row: DocumentRow, action: MaterialAction) {
    setNotice("");
    // Недоступный проект в беседу не передаётся: агент всё равно не сможет его подключить.
    const known = data.projects.some(p => p.id === row.projectId);
    void host.openPrompt(explorerPrompt(row.projectId, [{ nodeId: row.nodeId, name: [row.folder, row.name].filter(Boolean).join("/"), privateOnly: row.privateOnly }], materialPrompt(action, row.name)), known ? { projectId: row.projectId, title: row.projectName, materials: [{ nodeId: row.nodeId, name: row.name, privateOnly: row.privateOnly }] } : undefined)
      .catch(() => setNotice("Беседа не открылась. Повторите попытку."));
  }

  // Файлы из бесед ложатся в личное пространство; отсюда человек переносит их в рабочий проект.
  const userId = data.identity?.subject.user_id;
  const personalSpaces = useMemo(() => new Set(data.projects.filter(p => isPersonalSpace(p, userId)).map(p => p.id)), [data.projects, userId]);

  async function moveDocument(row: DocumentRow, target: MoveTarget) {
    setNotice(""); setMoved("");
    try {
      const doc = await ui.readDraftDocument(row.projectId, row.nodeId);
      if (!doc.exists) throw new Error("Личной версии файла нет: переносить нечего.");
      if (doc.conflicted) throw new Error("У файла конфликт версий. Сначала выберите вариант в личном черновике.");
      await ui.transferPrivateDocument(row.projectId, row.nodeId, { request_id: "move-" + crypto.randomUUID(), target_project_id: target.id, expected_head: doc.head });
    } catch (error) {
      const own = error instanceof Error && /^(Личной версии|У файла конфликт)/.test(error.message);
      setNotice(`Файл «${row.name}» не перенесён: ${own ? (error as Error).message : "Mnemos не принял перенос. Проверьте право на правку проекта и повторите."}`);
      return;
    }
    setMoved(`Файл «${row.name}» перенесён в проект «${target.name}»`);
    setOpened(current => current?.row.projectId === row.projectId && current.row.nodeId === row.nodeId ? null : current);
    await data.reloadProjects();
  }

  function moveFor(row: DocumentRow): MoveTargets | undefined {
    if (!personalSpaces.has(row.projectId)) return undefined;
    const targets = data.projects.filter(p => p.id !== row.projectId && p.canEdit !== false && !personalSpaces.has(p.id)).map(p => ({ id: p.id, name: p.name }));
    return { targets, onMove: target => moveDocument(row, target) };
  }

  function askAgent(text: string) {
    setNotice("");
    const project = data.projects.find(p => p.id === selected);
    void host.openPrompt(`Найди в материалах: ${text}`, project ? { projectId: project.id, title: project.name } : undefined)
      .catch(() => setNotice("Беседа не открылась. Повторите попытку."));
  }

  async function upload(directory = false) {
    if (uploading) return;
    setUploading(true); setNotice("");
    try {
      const result = await (selected ? host.pickInboxFiles(directory, selected) : host.pickInboxFiles(directory));
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
    <MaterialCard key={keyOf(row.projectId, row.nodeId)} row={row} fragment={fragment} folder={folder ?? (selected && !search ? undefined : row.folder)} terms={search ? terms : undefined}
      showProject={!selected} at={times.get(keyOf(row.projectId, row.nodeId))}
      selected={isOpened(row)} onOpen={() => selectDocument(row)} onChat={action => chat(row, action)} move={moveFor(row)} />
  );

  const preview = opened ? (
          <aside aria-label="Просмотр документа" className="min-w-0 rounded-xl border border-kumo-fill bg-kumo-overlay p-4 max-lg:order-first lg:self-start">
            <div className="mb-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-[17px] font-semibold tracking-[-0.2px] text-kumo-default [overflow-wrap:anywhere]">{opened.row.name}</h2>
                <p className="mt-0.5 mb-0 text-[13px] text-kumo-subtle">
                  {opened.row.projectName}{times.get(keyOf(opened.row.projectId, opened.row.nodeId)) && <>, изменён {relativeTime(times.get(keyOf(opened.row.projectId, opened.row.nodeId))!)}</>}
                </p>
              </div>
              <Button variant="ghost" size="sm" shape="square" icon={X} aria-label="Закрыть просмотр" onClick={closeDocument} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-1">
              {opened.row.status.tone !== "success" && <StatusBadge tone={opened.row.status.tone}>{opened.row.status.label}</StatusBadge>}
              <Button variant="secondary" size="sm" disabled={downloading} onClick={() => void download(opened.row)}>{downloading ? "Скачиваю…" : "Скачать оригинал"}</Button>
              <MaterialChatButtons onChat={action => chat(opened.row, action)} />
            </div>
            <div className="max-h-[68vh] overflow-auto rounded-[12px] bg-kumo-base p-4">
              {opened.error && <div className="space-y-2"><Notice tone="danger">{opened.error}</Notice><Button variant="secondary" size="sm" onClick={() => void open(opened.row)}>Повторить загрузку</Button></div>}
              {!opened.error && !opened.content && <p className="m-0 text-[14px] text-kumo-subtle">Загружаю…</p>}
              {opened.content && (opened.content.text && isMarkdown(opened.content.media_type, opened.row.name)
                ? <Markdown text={opened.content.text} className="text-[14px] leading-5 text-kumo-default" />
                : <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-kumo-default">{opened.content.text || (opened.content.text_state === "no_text" ? "В файле нет извлечённого текста. Вы можете скачать оригинал." : "(Пустой файл)")}</pre>)}
              {opened.content?.truncated && !!opened.content.next_offset && (!!opened.textHead || !!opened.content.revision) &&
                <div className="mt-3"><Button variant="secondary" size="sm" disabled={readingMore} onClick={() => void readMore()}>{readingMore ? "Читаю…" : "Показать ещё"}</Button></div>}
              {opened.content?.truncated && <p className="mt-3 mb-0 text-[13px] text-kumo-subtle">Показано начало документа. Полный файл доступен по кнопке «Скачать оригинал».</p>}
            </div>
          </aside>
) : null;
  return (
    <div className="max-w-full">
      {!selected && <PageHeader title="Материалы" subtitle="Документы организации, личные черновики и опубликованные версии." />}
      {currentProject && <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><button type="button" onClick={() => void host.openSection("projects", selected).catch(() => setNotice("Проект не открылся."))} className="mb-2 inline-flex items-center gap-1 text-[13px] text-kumo-brand"><ArrowLeft size={14} />К проекту</button><h1 className="m-0 text-[25px] font-semibold">{currentProject.name}</h1><p className="mb-0 mt-1 text-[14px] text-kumo-subtle">Файлы, папки и работа с Mnemos</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={uploading} icon={FileArrowUp} onClick={() => void upload()}>Загрузить файлы</Button>{!touchOnly && <Button variant="secondary" size="sm" disabled={uploading} icon={Folder} onClick={() => void upload(true)}>Загрузить папку</Button>}<Button size="sm" icon={ChatCircleText} onClick={() => askAgent(`Работаем над проектом «${currentProject.name}».`)}>Новая беседа</Button></div>
      </header>}
      <div className={selected ? "grid gap-5 xl:grid-cols-[200px_minmax(0,1fr)_280px]" : ""}>
      {selected && <aside className="min-w-0 rounded-xl border border-kumo-fill p-2 max-xl:hidden"><ExplorerFolders nodes={nodes} current={folder} onOpen={openFolder} /></aside>}
      <div className="min-w-0">
      {selected && <div role="tablist" aria-label="Содержимое проекта" className="mb-4 flex gap-4 border-b border-kumo-fill">{([["files", "Файлы"], ["chats", "Беседы"]] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)} className={`border-b-2 px-1 py-3 text-[14px] ${tab === id ? "border-kumo-brand font-semibold text-kumo-brand" : "border-transparent text-kumo-subtle"}`}>{label}</button>)}</div>}
      {tab === "chats" && selected ? <ProjectConversations key={selected} project={selected} /> : <>
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

        {!selected && data.projects.length > 1 && (
          <div role="group" aria-label="Проект" className="mt-3 flex items-center gap-1.5 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 max-sm:[scrollbar-width:none] sm:flex-wrap max-sm:[&>*]:shrink-0">
            <ProjectChip active={!selected} onClick={() => setSelected("")} count={`${total}${anyTruncated ? "+" : ""}`}>Все проекты</ProjectChip>
            {shownProjects.map(p => <ProjectChip key={p.id} active={selected === p.id} onClick={() => setSelected(p.id)} count={countOf(p.id)}>{p.name}</ProjectChip>)}
            {hiddenProjects > 0 && <button type="button" onClick={() => setAllProjects(true)} className="h-8 rounded-full px-3 text-[13px] text-kumo-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-kumo-ring">Ещё {hiddenProjects}</button>}
          </div>
        )}
      </div>

      {selected && <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><ExplorerPath nodes={nodes} current={folder} onOpen={openFolder} />{chosen.size > 0 && <div className="flex gap-3 text-[13px]"><button type="button" onClick={() => document.querySelector<HTMLTextAreaElement>("#project-assistant textarea")?.focus()} className="font-medium text-kumo-brand">Задача по выбранным ({chosen.size})</button><button type="button" onClick={() => setChosen(new Set())} className="text-kumo-subtle">Снять выбор</button></div>}</div>}
      {notice && <div className="mb-3"><Notice tone="danger">{notice}</Notice></div>}
      {moved && <div className="mb-3"><Notice tone="success">{moved}</Notice></div>}
      {data.projectsError && <div className="mb-3"><Notice tone="danger">{data.projectsError}</Notice></div>}

      <div className={opened && !selected ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]" : ""}>
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
              {noMaterials && shownFolders.length === 0 && !folder && <EmptyMaterials inProject={!!selected} uploading={uploading} onUpload={() => void upload()} />}
              {shownFolders.length > 0 && <div className="mb-3 overflow-hidden rounded-xl border border-kumo-fill bg-kumo-overlay">{shownFolders.map(dir => <div key={dir.node_id} className="flex items-center gap-3 border-t border-kumo-fill px-4 py-3 first:border-0">
                <input type="checkbox" aria-label={`Выбрать папку ${dir.name}`} checked={chosen.has(dir.node_id)} onChange={() => toggleChosen(dir.node_id)} className="h-4 w-4 shrink-0 accent-[var(--color-kumo-brand)]" />
                <button type="button" onClick={() => openFolder(dir.node_id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Folder size={24} weight="duotone" className="shrink-0 text-kumo-brand" /><span className="min-w-0 flex-1 truncate text-[15px] font-medium">{dir.name}</span><CaretRight size={16} className="text-kumo-subtle" /></button>
              </div>)}</div>}
              {folder && rows.length === 0 && shownFolders.length === 0 && !loadingNodes && !nodePage?.cursor && !currentProject?.privateCursor && <Notice>В этой папке пока нет файлов.</Notice>}
              {rows.length > 0 && <>
                <ListHeader>{scopeName ? `Файлов в папке: ${rows.length}` : `Все материалы: ${rows.length}`}{(selected ? (currentProject?.truncated || !!currentProject?.privateCursor) : anyTruncated) && " · список загружен не полностью"}</ListHeader>
                <div className="overflow-hidden rounded-[16px] border border-kumo-fill bg-kumo-overlay">{rows.map(row => selected ? <div key={row.nodeId} className="flex border-t border-kumo-fill first:border-0"><label className="flex shrink-0 items-start pl-4 pt-5"><input type="checkbox" aria-label={`Выбрать файл ${row.name}`} checked={chosen.has(row.nodeId)} onChange={() => toggleChosen(row.nodeId)} className="h-4 w-4" /></label><div className="min-w-0 flex-1">{materialRow(row)}</div></div> : materialRow(row))}</div>
              </>}
              {selected && <div className="mt-3">{loadingNodes ? <p role="status" className="text-[13px] text-kumo-subtle">Загружаю папки и файлы…</p> : (nodePage?.cursor || currentProject?.privateCursor) ? <Button size="sm" variant="secondary" onClick={() => void moreNodes()}>Загрузить ещё файлы и папки</Button> : currentProject?.truncated ? <Notice>Сервер не выдал продолжение списка. Найдите файл через поиск.</Notice> : null}</div>}
            </section>
          )}
        </div>

        {!selected && preview}
      </div>
      </> }
      </div>
      {selected && <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start"><ExplorerAssistant key={selected} targets={targets} contextName={folder ? folderPath(nodes, folder).map(n => n.name).join(" / ") : "Все материалы проекта"} onClear={() => setChosen(new Set())} onStart={async task => { setNotice(""); try { await host.openPrompt(explorerPrompt(selected, agentTargets, task), { projectId: selected, title: currentProject?.name ?? "Проект", materials: agentTargets }); } catch { setNotice("Беседа не открылась. Задача сохранена в поле, повторите попытку."); } }} /></aside>}
      </div>
      {selected && <Button icon={ChatCircleText} className="fixed bottom-4 right-4 z-20 xl:hidden" onClick={() => document.getElementById("project-assistant")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Mnemos{targets.length ? ` · ${targets.length}` : ""}</Button>}
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
        <p className="mt-1 mb-0 max-w-[460px] text-[14px] leading-5 text-kumo-subtle">{touchOnly ? "Загрузите файлы здесь или приложите их в беседе — агент предложит, куда их положить." : "Перетащите файлы в беседу — агент предложит, куда их положить. Или загрузите их здесь."}</p>
      </div>
      <Button size="sm" disabled={uploading} onClick={onUpload}>{uploading ? "Загружаю…" : "Загрузить файлы"}</Button>
    </div>
  );
}
