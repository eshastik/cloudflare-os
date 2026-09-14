import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@cloudflare/kumo";
import { ArrowLeft, CaretRight, Clock, FileText, MagnifyingGlass } from "@phosphor-icons/react";
import type { DocumentContent, ProjectSearchPage } from "../src/mnemos-api.ts";
import { useHost, useUi } from "./host.ts";
import { documentRows, type DocumentRow, type MemoryData } from "./data.ts";
import { LegacyPanel } from "./legacy.tsx";
import { relativeTime } from "./time.ts";
import { Eyebrow, Notice, Row, RowList, StatusBadge } from "./ui.tsx";

/** Время документа даёт только история; чтобы не грузить сервер, берём первую страницу истории для ограниченного числа строк. */
const HISTORY_ROWS = 40;
const HISTORY_PARALLEL = 4;

type SearchHit = ProjectSearchPage["hits"][number];
type Opened = { row: DocumentRow; content: DocumentContent | null; error: string };

export default function DocumentsTab({ data, initialProject = "" }: { data: MemoryData; initialProject?: string }) {
  const ui = useUi();
  const host = useHost();
  const [selected, setSelected] = useState(initialProject);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ query: string; hits: SearchHit[]; pending: boolean; failed: number; busy: boolean } | null>(null);
  const [times, setTimes] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const rowsByProject = useMemo(() => new Map(data.projects.map(p => [p.id, documentRows(p, data.reviews)])), [data.projects, data.reviews]);
  const visibleProjects = useMemo(() => selected ? data.projects.filter(p => p.id === selected) : data.projects, [data.projects, selected]);
  const rows = useMemo(() => visibleProjects.flatMap(p => rowsByProject.get(p.id) ?? []), [visibleProjects, rowsByProject]);
  const total = data.projects.reduce((sum, p) => sum + (rowsByProject.get(p.id)?.length ?? 0), 0);
  const anyTruncated = data.projects.some(p => p.truncated);

  useEffect(() => {
    const pending = rows.slice(0, HISTORY_ROWS).filter(row => !requested.current.has(`${row.projectId}/${row.nodeId}`));
    if (!pending.length) return;
    for (const row of pending) requested.current.add(`${row.projectId}/${row.nodeId}`);
    let next = 0;
    const worker = async () => {
      while (next < pending.length && mounted.current) {
        const row = pending[next++];
        try {
          const page = await ui.nodeHistory(row.projectId, row.nodeId, "");
          const at = page.events[0]?.recorded_at;
          if (at && mounted.current) setTimes(prev => new Map(prev).set(`${row.projectId}/${row.nodeId}`, at));
        } catch { /* без времени строка остаётся полезной */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(HISTORY_PARALLEL, pending.length) }, worker));
  }, [rows, ui]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) { setSearch(null); return; }
    setOpened(null);
    setSearch({ query: text, hits: [], pending: false, failed: 0, busy: true });
    const results = await Promise.allSettled(visibleProjects.map(p => ui.searchProject(p.id, text)));
    const hits: SearchHit[] = []; let pending = false, failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") { hits.push(...result.value.hits); pending ||= result.value.index_pending; }
      else failed++;
    }
    setSearch({ query: text, hits, pending, failed, busy: false });
  }

  async function open(row: DocumentRow) {
    setOpened({ row, content: null, error: "" });
    try {
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

  function rowFor(hit: SearchHit): DocumentRow {
    const known = rowsByProject.get(hit.project_id)?.find(r => r.nodeId === hit.node_id);
    if (known) return hit.name ? { ...known, name: hit.name } : known;
    const project = data.projects.find(p => p.id === hit.project_id);
    return { projectId: hit.project_id, projectName: project?.name ?? hit.project_id, nodeId: hit.node_id, name: hit.name || hit.node_id, status: { tone: "success", label: "Опубликовано" } };
  }

  if (opened && editing) return <LegacyPanel section={{kind: "document", project: opened.row.projectId, node: opened.row.nodeId}} title={opened.row.name} onClose={() => { setEditing(false); void data.reloadProjects(); }} />;

  if (opened) {
    return (
      <section aria-label="Содержимое документа">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => setOpened(null)}>К списку</Button>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Открыть личный черновик</Button>
        <h2 className="mt-3 mb-1 text-lg font-semibold text-kumo-strong">Содержимое документа</h2>
        <p className="m-0 text-[12px] text-kumo-subtle">{opened.row.projectName} · {opened.row.name}</p>
        <div className="mt-3 rounded-xl border border-kumo-line bg-kumo-elevated p-4">
          {opened.error && <><Notice tone="danger">{opened.error}</Notice><Button variant="secondary" onClick={() => void open(opened.row)}>Повторить загрузку</Button></>}
          {!opened.error && !opened.content && <Notice>Загрузка…</Notice>}
          {opened.content && <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">{opened.content.text || "(Пустой файл)"}</pre>}
          {opened.content?.truncated && <p className="mt-3 mb-0 text-[12px] text-kumo-subtle">Показано начало документа: он длиннее допустимого для просмотра.</p>}
        </div>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-[208px_minmax(0,1fr)] gap-6 max-md:grid-cols-1">
      <nav aria-label="Проекты" className="flex flex-col gap-0.5">
        <div className="px-2.5 pt-1 pb-2"><Eyebrow>Проекты</Eyebrow></div>
        <ProjectItem name="Все проекты" count={total} plus={anyTruncated} active={selected === ""} onClick={() => setSelected("")} />
        {data.projects.map(p => (
          <ProjectItem key={p.id} name={p.name} count={rowsByProject.get(p.id)?.length ?? 0} plus={p.truncated} active={selected === p.id} onClick={() => setSelected(p.id)} />
        ))}
        {data.projectsLoading && <p className="m-0 px-2.5 py-1 text-[12px] text-kumo-subtle">Загрузка…</p>}
        {data.projectsError && <Notice tone="danger">{data.projectsError}</Notice>}
      </nav>

      <div className="min-w-0">
        <form onSubmit={submitSearch} role="search" className="mb-3 flex items-center gap-3">
          <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-kumo-line bg-kumo-base px-3 text-kumo-inactive focus-within:border-kumo-ring">
            <MagnifyingGlass size={16} aria-hidden="true" />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по опубликованным документам…" aria-label="Поиск по опубликованным документам"
              className="w-full bg-transparent text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default outline-none placeholder:text-kumo-inactive" />
          </label>
          <Button type="submit" variant="secondary" disabled={search?.busy}>Найти</Button>
          {search && <Button type="button" variant="ghost" onClick={() => { setSearch(null); setQuery(""); }}>Очистить</Button>}
        </form>

        {search ? (
          <section aria-label="Результаты поиска">
            <p className="m-0 mb-2 text-[12px] text-kumo-subtle">
              {search.busy ? "Ищем…" : `Найдено: ${search.hits.length}`}
              {search.pending && " · индекс ещё обновляется, часть документов может не найтись"}
              {search.failed > 0 && ` · не опрошено проектов: ${search.failed}`}
            </p>
            {!search.busy && search.hits.length === 0 && <Notice>По запросу «{search.query}» ничего не найдено.</Notice>}
            {search.hits.length > 0 && (
              <RowList>
                {search.hits.map(hit => {
                  const row = rowFor(hit);
                  return (
                    <Row key={`${hit.project_id}/${hit.node_id}/${hit.ordinal}`} data-document={row.nodeId} className="items-start">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-kumo-line bg-kumo-elevated text-kumo-subtle"><FileText size={16} aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => void open(row)} className="m-0 block bg-transparent p-0 text-left text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-kumo-default hover:text-kumo-strong">{row.name}</button>
                        <div className="mt-0.5 text-[12px] text-kumo-subtle">{row.projectName}</div>
                        <p className="mt-1 mb-0 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default">{hit.text}</p>
                      </div>
                      <StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge>
                    </Row>
                  );
                })}
              </RowList>
            )}
          </section>
        ) : (
          <section aria-label="Документы">
            {visibleProjects.some(p => p.nodesError) && <div className="mb-2"><Notice tone="danger">Не удалось загрузить документы: {visibleProjects.filter(p => p.nodesError).map(p => p.name).join(", ")}. Проверьте доступ и обновите страницу.</Notice></div>}
            {rows.length === 0 && !data.projectsLoading && !visibleProjects.some(p => p.nodesError) && <Notice>{selected ? "В этом проекте пока нет документов." : "Документов пока нет."}</Notice>}
            {rows.length > 0 && (
              <RowList>
                {rows.map(row => {
                  const at = times.get(`${row.projectId}/${row.nodeId}`);
                  return (
                    <Row key={`${row.projectId}/${row.nodeId}`} data-document={row.nodeId}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-kumo-line bg-kumo-elevated text-kumo-subtle"><FileText size={16} aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => void open(row)} className="m-0 block max-w-full truncate bg-transparent p-0 text-left text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-kumo-default hover:text-kumo-strong">{row.name}</button>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-kumo-subtle">
                          <Clock size={11} aria-hidden="true" />
                          <span>{row.projectName}{at && <> · <time dateTime={at}>{relativeTime(at)}</time></>}</span>
                        </div>
                      </div>
                      <StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge>
                      <CaretRight size={13} className="text-kumo-inactive" aria-hidden="true" />
                    </Row>
                  );
                })}
              </RowList>
            )}
            {anyTruncated && <p className="mt-2 mb-0 text-[12px] text-kumo-subtle">Показана первая страница документов каждого проекта.</p>}
          </section>
        )}
      </div>
    </div>
  );
}

function ProjectItem({ name, count, plus, active, onClick }: { name: string; count: number; plus: boolean; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "true" : undefined}
      className={`flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] leading-[18px] tracking-[-0.25px] ${active ? "bg-kumo-fill font-medium text-kumo-strong" : "text-kumo-default hover:bg-kumo-tint"}`}>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="text-[11px] text-kumo-subtle">{count}{plus ? "+" : ""}</span>
    </button>
  );
}
