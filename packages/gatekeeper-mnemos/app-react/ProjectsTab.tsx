import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, FileText, Folder, Plus, Robot, UploadSimple } from "@phosphor-icons/react";
import type { PickedIntakeFile } from "../src/intake.ts";
import { groupRefusals, refusedLine } from "../src/upload-progress.ts";
import type { PolicyDomain, PublicationPolicy } from "../src/mnemos-api.ts";
import { VISIBILITY_TITLES } from "../src/project-sharing.ts";
import { useHost, useUi } from "./host.ts";
import { actorName, agentEnvironment, isAdministrator, looksLikeId, agentNames, documentRows, myApprovals, personName, UNNAMED_DOCUMENT, useLoad, type MemoryData, type ProjectData } from "./data.ts";
import { SharePanel, VisibilityBadge, VISIBILITY_NOTES } from "./ProjectSharing.tsx";
import ProjectApproval from "./ProjectApproval.tsx";
import { useReviewDecision } from "./ApprovalsTab.tsx";
import { plural } from "./names.ts";
import PersonAvatar from "./PersonAvatar.tsx";
import { ActionForm, Block, Button, Chip, ListRow, Notice, PageHeader, SectionTitle, StatusBadge, TextInput } from "./ui.tsx";

import ProjectIntake from "./ProjectIntake.tsx";
import { uploadActive, useProjectUpload, useUploadChoosing } from "./UploadNotice.tsx";
import ProjectCode, { type CompareTarget } from "./ProjectCode.tsx";
import GitHubSyncStatus from "./GitHubSyncStatus.tsx";
import ProjectTasks from "./ProjectTasks.tsx";

const COLLABORATION_STATES = { awaiting_result: "В работе", awaiting_review: "Ждёт приёмки", accepted: "Принято", changes_requested: "На доработке" } as const;
/** Сколько файлов показывать до «Показать все». */
const FILES_SHOWN = 8;

/** Раздел «Проекты»: слева список проектов, справа страница выбранного проекта одним экраном. */
export default function ProjectsTab({ data, initialProject = "", initialView = "", linkedDocument = null, onSelectProject, onSelectView, onOpenDocuments, onOpenSources }: { initialProject?: string; initialView?: string; linkedDocument?: LinkedDocument | null; data: MemoryData; onSelectProject(project: string): void; onSelectView?(view: string): void; onOpenDocuments(project: string): void; onOpenSources(): void }) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(initialProject);
  // Вкладка каждого проекта переживает возврат из прежних разделов, которые на время заменяют страницу.
  const [views, setViews] = useState<Record<string, ProjectView>>({});
  const selected = selectedId ? data.projects.find(p => p.id === selectedId) ?? null : data.projects[0] ?? null;
  // Вкладка из адреса действует только для проекта, с которым открыт раздел.
  const linked = viewFromAddress(initialView);
  // Адрес меняется и без перезагрузки фрейма (история, ссылка из другого раздела): выбор следует за ним.
  // Пустая вкладка в адресе ничего не сбрасывает — иначе поздний сигнал отменил бы щелчок пользователя.
  useEffect(() => { if (initialProject) setSelectedId(initialProject); }, [initialProject]);
  useEffect(() => {
    // Вкладка в адресе относится к проекту в адресе, а не к выбранному щелчком: поздний сигнал не должен
    // переносить вкладку прежнего проекта на новый.
    const project = initialProject || data.projects[0]?.id;
    if (linked && project) setViews(all => all[project] === linked ? all : { ...all, [project]: linked });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView, initialProject]);
  const viewOf = (id: string) => views[id] ?? (linked && (id === initialProject || !initialProject && id === data.projects[0]?.id) ? linked : "overview");

  return (
    <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)] max-md:grid-cols-1">
      <nav aria-label="Список проектов" className="flex flex-col gap-1.5 border-r border-kumo-fill px-4 py-7 max-md:border-r-0 max-md:border-b">
        <div className="flex items-center gap-2 px-2 pb-3">
          <h1 className="m-0 flex-1 text-[22px] leading-7 font-semibold tracking-[-0.5px] text-kumo-default">Проекты</h1>
          <Button variant="ghost" size="sm" shape="circle" aria-label="Обновить" title="Обновить список" icon={<ArrowClockwise size={16} aria-hidden="true" />} onClick={() => void data.reloadProjects()} />
          {canCreateProjects(data.identity) && <Button variant="secondary" size="sm" shape="circle" aria-label="Новый проект" title="Новый проект" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)} />}
        </div>
        {data.projects.map(p => {
          const current = !creating && selected?.id === p.id;
          return (
            <div key={p.id} className={`relative rounded-[12px] border px-3 py-2.5 ${current ? "border-kumo-fill bg-kumo-overlay" : "border-transparent hover:bg-kumo-tint"}`}>
              <button type="button" aria-current={current ? "true" : undefined} onClick={() => { setCreating(false); if (selected?.id !== p.id) { setSelectedId(p.id); onSelectProject(p.id); } }}
                className={`block w-full truncate border-0 bg-transparent p-0 text-left text-[15px] leading-5 text-kumo-default after:absolute after:inset-0 after:content-[''] ${current ? "font-semibold" : ""}`}>{p.name}</button>
              {projectNote(p) && <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-kumo-subtle">{projectNote(p)}</span>}
            </div>
          );
        })}
        {data.projectsLoading && <p className="m-0 px-3 py-1 text-[13px] text-kumo-subtle">Загрузка…</p>}
        {data.projectsError && <div className="px-3"><Notice tone="danger">{data.projectsError}</Notice></div>}
        {!data.projectsLoading && !data.projectsError && data.projects.length === 0 && <div className="px-3"><Notice>Доступных проектов нет.</Notice></div>}
      </nav>
      <div className="min-w-0 px-4 py-7 sm:px-10">
        {creating
          ? <CreateProject onCreated={async id => { setSelectedId(id); setCreating(false); await data.reloadProjects(); onSelectProject(id); }} onCancel={() => setCreating(false)} />
          : selected
            ? <ProjectPage key={selected.id} project={selected} data={data} view={viewOf(selected.id)} linkedDocument={selected.id === initialProject ? linkedDocument : null} onView={view => { setViews(all => ({ ...all, [selected.id]: view })); onSelectView?.(ADDRESS[view]); }} onOpenDocuments={() => onOpenDocuments(selected.id)} onOpenSources={onOpenSources} />
            : !data.projectsLoading && <Notice>{selectedId ? "Проект недоступен. Выберите другой проект из списка." : "Выберите проект слева."}</Notice>}
      </div>
    </div>
  );
}

/** Подпись проекта в списке: кому виден и сколько в нём файлов. */
function projectNote(project: ProjectData): string {
  const files = project.nodes.filter(n => !n.is_dir).length;
  return [project.visibility ? VISIBILITY_TITLES[project.visibility] : "", files ? `${files}${project.truncated ? "+" : ""} ${plural(files, "файл", "файла", "файлов")}` : ""].filter(Boolean).join(" · ");
}

type ProjectView = "overview" | "materials" | "code" | "tasks" | "people";
/** Документ проекта из адреса страницы; seq отличает повторный переход по той же ссылке. */
export type LinkedDocument = { node: string; seq: number };
/** Имена вкладок в адресе страницы; «Участники» в адресе — members. */
const ADDRESS: Record<ProjectView, string> = { overview: "overview", materials: "materials", code: "code", tasks: "tasks", people: "members" };
function viewFromAddress(value: string): ProjectView | null {
  const found = (Object.entries(ADDRESS) as [ProjectView, string][]).find(([, name]) => name === value);
  return found ? found[0] : null;
}

/** Страница проекта — один экран: заголовок и описание, файлы, что сейчас ждёт решения, кто видит,
 * согласование, источники и код (если подключён). Вкладка из адреса страницы только прокручивает к своему блоку. */
function ProjectPage({ project, data, view, linkedDocument = null, onOpenDocuments, onOpenSources }: { project: ProjectData; data: MemoryData; view: ProjectView; linkedDocument?: LinkedDocument | null; onView(view: ProjectView): void; onOpenDocuments(): void; onOpenSources(): void }) {
  const ui = useUi();
  const host = useHost();
  const [actionError, setActionError] = useState("");
  const [sharing, setSharing] = useState(false);
  const overview = useLoad(() => ui.readProjectOverview(project.id, ""), "", [ui, project.id]);
  const repositories = useLoad(async () => (await ui.listProjectGitRepositories(project.id, "")).repositories.filter(r => r.enabled), "", [ui, project.id]);
  const hasCode = (repositories.value?.length ?? 0) > 0;
  const [compareTo, setCompareTo] = useState<CompareTarget | null>(null);
  useEffect(() => {
    if (view === "overview") return;
    const id = view === "tasks" ? "code" : view;
    document.getElementById(`project-${id}`)?.scrollIntoView?.({ block: "start" });
  }, [view, hasCode]);
  const share = () => { setSharing(true); document.getElementById("project-share")?.scrollIntoView?.({ block: "start" }); };

  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader level={2} title={project.name} subtitle={overview.value?.l0 || undefined}
        actions={<>
          <Button variant="secondary" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>Поделиться</Button>
          <Button onClick={() => { setActionError(""); void host.openPrompt(`Работаем над проектом «${project.name}».\n\n`, {projectId:project.id,title:project.name}).catch(() => setActionError("Не удалось начать беседу. Повторите попытку.")); }}>Начать беседу</Button>
        </>}>
        <div className="mt-2.5"><VisibilityBadge project={project} /></div>
      </PageHeader>
      {actionError && <div className="mb-4"><Notice tone="danger">{actionError}</Notice></div>}
      <GitHubSyncStatus projectId={project.id} fileCount={project.nodes.filter(n => !n.is_dir).length} moreFiles={project.truncated} canEdit={project.canEdit !== false} onCodeConnected={() => void repositories.reload()} />
      <div id="project-share">{sharing && <SharePanel project={project} onClose={() => setSharing(false)} onChanged={data.reloadProjects} />}</div>
      <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {overview.value?.l1 ? <p className="mt-0 mb-7 max-w-[650px] whitespace-pre-line text-[15px] leading-[23px] text-kumo-default">{overview.value.l1}</p>
            : <div className="mb-7"><Notice>{overview.value?.pending ? "Описание проекта готовится по его материалам." : "Описание проекта появится, когда в нём будут материалы."}</Notice></div>}
          <ProjectFiles project={project} data={data} descriptions={overview.value?.children ?? []} linkedDocument={linkedDocument} onOpenDocuments={onOpenDocuments} />
        </div>
        <div className="min-w-0">
          <ProjectNow project={project} data={data} />
          <ProjectPeople project={project} data={data} onOpenSources={onOpenSources} onShare={share} />
        </div>
      </div>
      {hasCode && repositories.value && <section id="project-code" aria-label="Код" className="mt-2 mb-7">
        <SectionTitle title="Код" />
        <ProjectCode admin={isAdministrator(data.identity)} key={compareTo ? `${compareTo.connection_id}/${compareTo.repository_id}/${compareTo.branch}` : "code"} projectId={project.id} repositories={repositories.value} compareTo={compareTo} />
        <div className="mt-4"><ProjectTasks admin={isAdministrator(data.identity)} projectId={project.id} repositories={repositories.value}
          onCompare={task => { setCompareTo({ connection_id: task.connection_id, repository_id: task.repository_id, branch: task.branch }); document.getElementById("project-code")?.scrollIntoView?.({ block: "start" }); }} /></div>
      </section>}
    </div>
  );
}

/** «Сейчас»: что по проекту ждёт решения текущего человека и какая работа идёт. Согласование — кнопкой на месте. */
function ProjectNow({ project, data }: { project: ProjectData; data: MemoryData }) {
  const decision = useReviewDecision(data);
  const userId = data.identity?.subject.user_id ?? "";
  const approvals = myApprovals(data.reviews, userId).filter(item => item.review.project_id === project.id && item.mine === null && !item.review.stale && !item.review.withdrawn);
  const work = data.collaborations.filter(item => item.request.project_id === project.id);
  const task = data.task && (data.task.tracker?.project_id === project.id || data.task.team_budget?.project_id === project.id || data.task.budget_request?.project_id === project.id) ? data.task : null;
  const nodeName = (id: string) => project.nodes.find(n => n.node_id === id)?.name || project.privateDocs.get(id)?.name || UNNAMED_DOCUMENT;
  const waiting = approvals.length + work.length + (task ? 1 : 0);
  const item = "flex items-center gap-3 border-t border-kumo-fill px-4 py-3.5 first:border-t-0";
  return (
    <Block title="Сейчас" count={waiting} empty={data.collaborationsError || "Сейчас по проекту ничего не ждёт вашего решения."}>
      {decision.notice && <div className="mb-2"><Notice tone={decision.notice.tone}>{decision.notice.text}</Notice></div>}
      <div className="overflow-hidden rounded-[16px] border border-kumo-fill bg-kumo-overlay">
        {approvals.map(a => {
          const key = `${a.review.candidate_id}/${a.domain.domain_id}`;
          return (
            <div key={key} className={item}>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] leading-5 text-kumo-default">Согласовать «{a.domain.node_ids.map(nodeName).join(", ")}»</div>
                <div className="mt-0.5 text-[13px] text-kumo-subtle">направление {a.domain.domain_id} · автор {personName(a.review.author_id)}</div>
              </div>
              <Button size="sm" disabled={decision.busy === key} onClick={() => void decision.decide(a, true)}>Согласовать</Button>
            </div>
          );
        })}
        {task && (
          <div className={item}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] leading-5 text-kumo-default">Задача агента: {task.message.slice(0, 80)}</div>
              <div className="mt-0.5 text-[13px] text-kumo-subtle">ведёт {agentNames(data.connections).get(task.binding_id) ?? "ваш агент"}</div>
            </div>
            <Chip tone={task.outcome?.state === "completed" ? "warning" : "neutral"}>{task.outcome?.state === "completed" ? "Ждёт приёмки" : task.submitted ? "В работе" : "Не отправлена"}</Chip>
          </div>
        )}
        {work.map(w => (
          <div key={w.request.request_id} className={item}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] leading-5 text-kumo-default">{w.request.title}</div>
              <div className="mt-0.5 text-[13px] text-kumo-subtle">ведёт: {actorName(data.connections, w.request.target_agent_id, w.request.target_user_id)} · от: {actorName(data.connections, w.request.requester_agent_id, w.request.requester_user_id)} · документ «{nodeName(w.request.node_id)}»</div>
            </div>
            <Chip tone={w.progress?.state === "awaiting_review" ? "warning" : w.progress?.state === "accepted" ? "success" : w.progress?.state === "changes_requested" ? "danger" : "neutral"}>{w.progress ? COLLABORATION_STATES[w.progress.state] : "Состояние недоступно"}</Chip>
          </div>
        ))}
      </div>
    </Block>
  );
}

/** «Файлы»: папки и документы проекта. Документ открывается рядом с беседой в своём редакторе. */
function ProjectFiles({ project, data, descriptions, linkedDocument = null, onOpenDocuments }: { project: ProjectData; data: MemoryData; descriptions: { node_id: string; name: string; is_dir: boolean; l0: string }[]; linkedDocument?: LinkedDocument | null; onOpenDocuments(): void }) {
  const host = useHost();
  const [actionError, setActionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<PickedIntakeFile[]>([]);
  const [all, setAll] = useState(false);
  // Ход загрузки рисует уведомление (UploadNotice): здесь оно встаёт в блок «Файлы».
  const upload = useProjectUpload(project.id);
  // Хост с очередью ведёт загрузку сам: следующую можно начать, пока идёт прежняя. Старый хост — по одной.
  const choosing = useUploadChoosing();
  const busy = upload.live ? choosing : uploading || uploadActive(upload.view);
  useEffect(() => {
    const refresh = (event: MessageEvent) => {
      if (event.source === window.parent && event.data?.type === "mnemos-inbox-updated") void data.reloadProjects();
    };
    window.addEventListener("message", refresh);
    return () => window.removeEventListener("message", refresh);
  }, [data.reloadProjects]);
  async function pick(directory: boolean) {
    if (busy) return;
    setUploading(true); setActionError("");
    try {
      const result = await host.pickInboxFiles(directory, project.id);
      if (result.length) { setUploaded(result); await data.reloadProjects(); }
    } catch { setActionError("Загрузка не завершена. Проверьте материалы проекта перед повтором."); }
    finally { setUploading(false); }
  }
  function openDocument(nodeId: string) {
    setActionError("");
    void host.openNativeDocument(project.id, nodeId).then(opened => { if (!opened) void host.openSection("documents", project.id); }).catch(() => setActionError("Не удалось открыть документ. Проверьте подключение и повторите попытку."));
  }
  // Ссылка на документ (из хода агента в беседе) открывает его так же, как щелчок в списке, — один раз
  // на переход. Строка документа выделяется и прокручивается в видимую часть, если она показана.
  const [highlighted, setHighlighted] = useState("");
  const openedLink = useRef(0);
  useEffect(() => {
    if (!linkedDocument || openedLink.current === linkedDocument.seq) return;
    openedLink.current = linkedDocument.seq;
    setHighlighted(linkedDocument.node);
    openDocument(linkedDocument.node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedDocument]);
  const ui = useUi();
  // Личные документы других людей в этом проекте, открытые вам: в общих файлах проекта их нет.
  const shared = useLoad(async () => (await ui.listSharedDocuments().catch(() => [])).filter(d => d.project_id === project.id), "", [ui, project.id]);
  const materials = useMemo(() => documentRows(project, data.reviews), [project, data.reviews]);
  const described = useMemo(() => new Map(descriptions.filter(d => d.l0).map(d => [d.node_id, d.l0])), [descriptions]);
  const folders = project.nodes.filter(n => n.is_dir);
  const total = folders.length + materials.length;
  // Документ по ссылке может лежать дальше первых строк: тогда он всё равно показывается в списке.
  const linkedRow = highlighted ? materials.find(row => row.nodeId === highlighted) : undefined;
  const shownFolders = all ? folders : folders.slice(0, FILES_SHOWN);
  const firstFiles = all ? materials : materials.slice(0, Math.max(0, FILES_SHOWN - shownFolders.length));
  const shownFiles = linkedRow && !firstFiles.includes(linkedRow) ? [linkedRow, ...firstFiles] : firstFiles;
  useEffect(() => {
    if (highlighted) [...document.querySelectorAll("[data-document]")].find(row => row.getAttribute("data-document") === highlighted)?.scrollIntoView?.({ block: "center" });
  }, [highlighted, !!linkedRow]);
  const name = "block max-w-full truncate border-0 bg-transparent p-0 text-left text-[15px] leading-5 text-kumo-default hover:text-kumo-brand";
  return (
    <section id="project-materials" aria-label="Файлы" className="mb-7">
      {/* Сервер не отдаёт общего числа: список читается постранично, недочитанный счёт помечен «+». */}
      <SectionTitle title="Файлы" count={`${materials.length}${project.truncated ? "+" : ""}`} actions={<>
        <Button variant="secondary" size="sm" disabled={busy} icon={<UploadSimple size={15} aria-hidden="true" />} onClick={() => void pick(false)}>Загрузить файлы</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void pick(true)}>Выбрать папку</Button>
      </>} />
      {upload.card}
      {uploading && !upload.live && <p role="status" className="m-0 mb-2 text-[14px] text-kumo-subtle">Загружаем в проект…</p>}
      {actionError && <div className="mb-2"><Notice tone="danger">{actionError}</Notice></div>}
      {uploaded.length > 0 && !upload.live && <div className="mb-4 text-[14px]" role="status">
        <p className="m-0 text-kumo-subtle">Принято файлов: {uploaded.filter(file => !file.error && !file.refused && !file.stopped).length} из {uploaded.length}.</p>
        {uploaded.some(file => file.refused) && <p className="m-0 mt-1 text-kumo-subtle" data-upload-refused="">{refusedLine(groupRefusals(uploaded.flatMap(file => file.refused ? [{ path: file.path, ...file.refused }] : [])))}.</p>}
        {uploaded.some(file => file.receipt?.placement_state === "personal") && <p className="m-0 mt-1">Файлы сохранены как личные черновики проекта. Для общего доступа их нужно опубликовать.</p>}
        {/* Папка может дать тысячи файлов: подробности — по первым, полный итог и повтор показывает оболочка. */}
        {uploaded.filter(file => file.error).slice(0, 5).map((file, index) => <Notice key={index} tone="danger">{file.path}: {file.error}</Notice>)}
        {uploaded.filter(file => file.error).length > 5 && <p className="m-0 mt-1 text-kumo-subtle">Не подтверждено ещё {uploaded.filter(file => file.error).length - 5}.</p>}
      </div>}
      <ProjectIntake projectId={project.id} onPlaced={data.reloadProjects} />
      {total === 0 && !shared.value?.length
        ? !(uploading || uploadActive(upload.view)) && <Notice>{project.nodesError ? "Документы проекта не прочитаны: проверьте доступ." : "Документов пока нет. Загрузите файлы или папку."}</Notice>
        : <div>
          {shownFolders.map(folder => (
            <ListRow key={folder.node_id} icon={<Folder size={18} />}>
              <button type="button" className={name} onClick={onOpenDocuments}>{folder.name}</button>
              {described.get(folder.node_id) && <div className="mt-0.5 line-clamp-2 text-[13px] text-kumo-subtle">{described.get(folder.node_id)}</div>}
            </ListRow>
          ))}
          {shownFiles.map(row => (
            <ListRow key={row.nodeId} data-document={row.nodeId} aria-current={row.nodeId === highlighted ? "true" : undefined} className={row.nodeId === highlighted ? "rounded-[10px] bg-selection-bg" : ""} icon={<FileText size={18} />}
              meta={row.status.tone === "success" ? undefined : <StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge>}>
              <button type="button" className={row.nodeId === highlighted ? `${name} font-semibold text-kumo-brand` : name} onClick={() => { setHighlighted(row.nodeId); openDocument(row.nodeId); }}>{row.name}</button>
              {described.get(row.nodeId) && <div className="mt-0.5 line-clamp-2 text-[13px] text-kumo-subtle">{described.get(row.nodeId)}</div>}
            </ListRow>
          ))}
          {(shared.value ?? []).map(doc => (
            <ListRow key={`shared/${doc.owner_id}/${doc.node_id}`} data-shared-document="" icon={<FileText size={18} />}
              meta={<StatusBadge tone="neutral">{doc.mode === "write" ? "можно править" : "можно читать"}</StatusBadge>}>
              <button type="button" className={name} onClick={() => openDocument(doc.node_id)}>{doc.name}</button>
              <div className="mt-0.5 text-[13px] text-kumo-subtle">поделился {doc.granted_by_name || doc.owner_name || "коллега"}</div>
            </ListRow>
          ))}
          <div className="flex flex-wrap items-center gap-3 px-1 pt-3 text-[14px]">
            {!all && total > shownFolders.length + shownFiles.length && <button type="button" className="border-0 bg-transparent p-0 text-kumo-brand hover:text-kumo-brand-hover" onClick={() => setAll(true)}>Показать все {total}</button>}
            <button type="button" className="border-0 bg-transparent p-0 text-kumo-brand hover:text-kumo-brand-hover" onClick={onOpenDocuments}>Все документы проекта</button>
          </div>
          {project.truncated && <p className="mt-2 mb-0 text-[13px] text-kumo-subtle">Показаны не все файлы: проект слишком большой для списка на этой странице. Остальное — по ссылке «Все документы проекта».</p>}
        </div>}
    </section>
  );
}

/** «Кто видит»: уровень доступа, согласующие и агенты с доступом; ниже — согласование и источники материалов. */
function ProjectPeople({ project, data, onOpenSources, onShare }: { project: ProjectData; data: MemoryData; onOpenSources(): void; onShare(): void }) {
  const ui = useUi();
  const policy = useLoad(() => ui.readPublicationPolicy(project.id), "Политика согласования не прочитана: нет права или сервер отказал.", [ui, project.id]);
  const approvers = useLoad(() => ui.listPolicyApprovers(project.id, ""), "Список согласующих не прочитан.", [ui, project.id]);
  const mail = useLoad(() => ui.listMailConnections(""), "почта: сервер отказал", [ui]);
  const calendars = useLoad(() => ui.listCalendarConnections(""), "календарь: сервер отказал", [ui]);
  const databases = useLoad(() => ui.listVisibleDatabaseConnections(), "базы: сервер отказал", [ui]);
  const names = useMemo(() => new Map((approvers.value?.approvers ?? []).map(a => [a.principal_id, a.display_name || personName(a.principal_id)])), [approvers.value]);
  const agentTitles = useMemo(() => agentNames(data.connections), [data.connections]);
  const members = useMemo(() => membersByDomain(policy.value, names), [policy.value, names]);
  const absence = data.absences.get(project.id);
  const agents = data.connections.filter(c => !c.revoked && c.document_grants?.some(g => g.project_id === project.id));
  const sources = [
    ...(mail.value?.connections ?? []).filter(c => c.project_id === project.id).map(c => ({ key: `mail/${c.connection_id}`, kind: "Почта", title: "Письма проекта", note: c.enabled ? "чтение агентом · отправка письма только после согласования" : "отключено" })),
    ...(calendars.value?.connections ?? []).filter(c => c.project_id === project.id).map(c => ({ key: `cal/${c.connection_id}`, kind: "Календарь", title: looksLikeId(c.calendar_id) ? "Календарь проекта" : `Календарь «${c.calendar_id}»`, note: c.enabled ? "чтение окна · встреча только после согласования черновика" : "отключено" })),
    ...(databases.value?.databases ?? []).filter(d => d.project_id === project.id).map(d => ({ key: `db/${d.db_id}`, kind: "База", title: d.name, note: d.unreachable_since ? `ошибка доступа с ${new Date(d.unreachable_since).toLocaleString("ru-RU")}` : "запросы агента только на чтение" })),
  ];
  const sourceErrors = [mail.error, calendars.error, databases.error].filter(Boolean);
  const peopleError = policy.error || approvers.error;
  return (
    <div>
      <section id="project-members" aria-label="Кто видит" className="mb-7">
        <SectionTitle title="Кто видит" actions={<Button variant="ghost" size="sm" onClick={onShare}>Изменить доступ</Button>} />
        {project.visibility && <p className="m-0 mb-3 text-[14px] leading-5 text-kumo-subtle">{VISIBILITY_NOTES[project.visibility]}</p>}
        {members.length === 0 && agents.length === 0 && <Notice>{peopleError || "Участники не назначены."}</Notice>}
        {members.map(member => (
          <div key={member.id} className="flex items-center gap-3 border-b border-kumo-fill py-2.5">
            <PersonAvatar name={member.name} id={member.id} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] text-kumo-default">{member.name}</div>
              <div className="text-[13px] text-kumo-subtle">{member.domains.length ? `Согласует направление ${member.domains.join(", ")}` : "Участник"}</div>
            </div>
          </div>
        ))}
        {agents.map(agent => {
          const role = absence?.enabled && absence.local_binding_id === agent.binding_id ? "замещается" : absence?.enabled && absence.managed_binding_id === agent.binding_id ? `замещает до ${new Date(absence.ends_at).toLocaleString("ru-RU")}` : "";
          return (
            <div key={agent.binding_id} className="flex items-center gap-3 border-b border-kumo-fill py-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selection-bg text-kumo-brand"><Robot size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] text-kumo-default">{agentTitles.get(agent.binding_id) ?? "Агент"}</div>
                <div className="text-[13px] text-kumo-subtle">ваш агент · {agentEnvironment(agent)}{role ? ` · ${role}` : ""}</div>
              </div>
            </div>
          );
        })}
        {(members.length > 0 || agents.length > 0) && data.connectionsError && <div className="mt-2"><Notice tone="danger">{data.connectionsError}</Notice></div>}
        {agents.length > 0 && <p className="m-0 mt-2 text-[13px] text-kumo-subtle">Каждый агент видит не больше вас.</p>}
      </section>
      <ProjectApproval project={project} />
      <Block title="Откуда приходят материалы" count={sources.length} empty={sourceErrors.length ? `Подключения не прочитаны: ${sourceErrors.join("; ")}.` : "К проекту не подключены почта, календарь или базы."}
        actions={isAdministrator(data.identity) ? <Button variant="ghost" size="sm" onClick={onOpenSources}>Все подключения</Button> : undefined}>
        {sourceErrors.length > 0 && <div className="mb-2"><Notice tone="danger">Часть подключений не прочитана: {sourceErrors.join("; ")}.</Notice></div>}
        {sources.map(source => (
          <div key={source.key} className="flex items-start gap-3 border-b border-kumo-fill py-2.5">
            <Chip>{source.kind}</Chip>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] text-kumo-default">{source.title}</div>
              <div className="text-[13px] text-kumo-subtle">{source.note}</div>
            </div>
          </div>
        ))}
      </Block>
    </div>
  );
}

function membersByDomain(policy: PublicationPolicy | null, names: Map<string, string>): { id: string; name: string; domains: string[] }[] {
  const byId = new Map<string, string[]>();
  for (const domain of policy?.domains ?? ([] as PolicyDomain[])) {
    for (const id of domain.approver_ids) byId.set(id, [...(byId.get(id) ?? []), domain.domain_id]);
  }
  for (const id of names.keys()) if (!byId.has(id)) byId.set(id, []);
  return [...byId].map(([id, domains]) => ({ id, name: personName(id, names), domains })).sort((a, b) => b.domains.length - a.domains.length || a.name.localeCompare(b.name, "ru"));
}

/** Создать проект может каждый, кому это разрешает правило организации (решение владельца 23.09);
 * тенантное полномочие project.create — у администраторов. Проверяет всё равно сервер. */
function canCreateProjects(identity: MemoryData["identity"]): boolean {
  return !!identity?.capabilities?.includes("project.create") || !!identity?.roles?.can_create_projects;
}

function CreateProject({ onCreated, onCancel }: { onCreated(id: string): Promise<void>; onCancel(): void }) {
  const ui = useUi();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try {
      // Краткое имя проекта сервер придумывает сам: человеку служебный код не нужен.
      const result = await ui.createProject(name.trim(), "");
      await onCreated(result.project.id);
    } catch {
      setError("Проект не создан или ответ не получен. Проверьте список проектов, имя и ваши полномочия перед повтором.");
    } finally { setBusy(false); }
  }
  return <ActionForm aria-label="Новый проект" onAction={() => void submit()}
    className="mx-auto mt-6 flex max-w-[560px] flex-col gap-[22px] rounded-[24px] bg-kumo-overlay p-8 shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
    <div className="flex items-center gap-4">
      <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-selection-bg text-kumo-brand"><Folder size={28} /></span>
      <div>
        <h2 className="m-0 text-[24px] leading-[30px] font-semibold tracking-[-0.5px] text-kumo-default">Новый проект</h2>
        <p className="mt-1.5 mb-0 text-[15px] leading-[22px] text-kumo-subtle">Файлы добавите на странице проекта. Кому он виден, решите кнопкой «Поделиться».</p>
      </div>
    </div>
    <label className="flex flex-col gap-2 text-[14px] text-kumo-subtle">Название
      <TextInput required maxLength={255} value={name} onChange={e => setName(e.target.value)} disabled={busy} className="h-[46px] text-[16px]" />
    </label>
    {error && <Notice tone="danger">{error}</Notice>}
    <div className="flex justify-end gap-2.5">
      <Button variant="secondary" size="lg" disabled={busy} onClick={onCancel}>Отмена</Button>
      <Button size="lg" onClick={() => void submit()} disabled={busy || !name.trim()}>Создать проект</Button>
    </div>
  </ActionForm>;
}
