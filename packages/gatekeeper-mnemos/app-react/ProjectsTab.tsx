import { useEffect, useMemo, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { FileText, UploadSimple } from "@phosphor-icons/react";
import type { PickedIntakeFile } from "../src/intake.ts";
import type { PolicyDomain, PublicationPolicy } from "../src/mnemos-api.ts";
import { useHost, useUi } from "./host.ts";
import { agentEnvironment, documentRows, useLoad, type MemoryData, type ProjectData } from "./data.ts";
import { LegacySwitch, useLegacySection } from "./legacy.tsx";
import { Block, Eyebrow, Notice, Row, RowList, RowText, StatusBadge, TextInput } from "./ui.tsx";

const COLLABORATION_STATES = { awaiting_result: "В работе", awaiting_review: "Ждёт приёмки", accepted: "Принято", changes_requested: "На доработке" } as const;
const MATERIALS_LIMIT = 8;

export default function ProjectsTab({ data, initialProject = "", onSelectProject, onOpenDocuments, onOpenSources }: { initialProject?: string; data: MemoryData; onSelectProject(project: string): void; onOpenDocuments(project: string): void; onOpenSources(): void }) {
  const legacy = useLegacySection();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(initialProject);
  const selected = selectedId ? data.projects.find(p => p.id === selectedId) ?? null : data.projects[0] ?? null;

  return (
    <LegacySwitch state={legacy}>
      <div className="grid grid-cols-[208px_minmax(0,1fr)] gap-6 max-md:grid-cols-1">
        <nav aria-label="Список проектов" className="flex flex-col gap-0.5">
          <div className="px-2.5 pt-1 pb-2"><Eyebrow>Мои проекты</Eyebrow></div>
          {data.projects.map(p => (
            <button key={p.id} type="button" onClick={() => { if (selected?.id !== p.id) { setSelectedId(p.id); onSelectProject(p.id); } }} aria-current={selected?.id === p.id ? "true" : undefined}
              className={`flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] leading-[18px] tracking-[-0.25px] ${selected?.id === p.id ? "bg-kumo-fill font-medium text-kumo-strong" : "text-kumo-default hover:bg-kumo-tint"}`}>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </button>
          ))}
          {data.projectsLoading && <p className="m-0 px-2.5 py-1 text-[12px] text-kumo-subtle">Загрузка…</p>}
          {data.projectsError && <Notice tone="danger">{data.projectsError}</Notice>}
          {!data.projectsLoading && !data.projectsError && data.projects.length === 0 && <Notice>Доступных проектов нет.</Notice>}
          {data.identity?.capabilities?.includes("project.create") && <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>Создать проект</Button>}
          {creating && <CreateProject onCreated={async id => { setSelectedId(id); setCreating(false); await data.reloadProjects(); onSelectProject(id); }} onCancel={() => setCreating(false)} />}

        </nav>
        <div className="min-w-0">
          {selected
            ? <ProjectPage key={selected.id} project={selected} data={data} onOpenDocuments={() => onOpenDocuments(selected.id)} onOpenSources={onOpenSources} openLegacy={legacy.open} />
            : !data.projectsLoading && <Notice>{selectedId ? "Проект недоступен. Выберите другой проект из списка." : "Выберите проект слева."}</Notice>}
        </div>
      </div>
    </LegacySwitch>
  );
}

function ProjectPage({ project, data, onOpenDocuments, onOpenSources, openLegacy }: { project: ProjectData; data: MemoryData; onOpenDocuments(): void; onOpenSources(): void; openLegacy: ReturnType<typeof useLegacySection>["open"] }) {
  const ui = useUi();
  const host = useHost();
  const [actionError, setActionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<PickedIntakeFile[]>([]);
  useEffect(() => {
    const refresh = (event: MessageEvent) => {
      if (event.source === window.parent && event.data?.type === "mnemos-inbox-updated") void data.reloadProjects();
    };
    window.addEventListener("message", refresh);
    return () => window.removeEventListener("message", refresh);
  }, [data.reloadProjects]);
  async function upload(directory: boolean) {
    if (uploading) return;
    setUploading(true); setActionError("");
    try {
      const result = await host.pickInboxFiles(directory, project.id);
      if (result.length) { setUploaded(result); await data.reloadProjects(); }
    } catch { setActionError("Загрузка не завершена. Проверьте материалы проекта перед повтором."); }
    finally { setUploading(false); }
  }

  const policy = useLoad(() => ui.readPublicationPolicy(project.id), "Политика согласования не прочитана: нет права или сервер отказал.", [ui, project.id]);
  const approvers = useLoad(() => ui.listPolicyApprovers(project.id, ""), "Список согласующих не прочитан.", [ui, project.id]);
  const mail = useLoad(() => ui.listMailConnections(""), "почта: сервер отказал", [ui]);
  const calendars = useLoad(() => ui.listCalendarConnections(""), "календарь: сервер отказал", [ui]);
  const databases = useLoad(() => ui.listVisibleDatabaseConnections(), "базы: сервер отказал", [ui]);

  const names = useMemo(() => new Map((approvers.value?.approvers ?? []).map(a => [a.principal_id, a.display_name || a.principal_id])), [approvers.value]);
  const nodeName = (id: string) => project.nodes.find(n => n.node_id === id)?.name ?? project.privateDocs.get(id)?.name ?? id;
  const members = useMemo(() => membersByDomain(policy.value, names), [policy.value, names]);
  const materials = useMemo(() => documentRows(project, data.reviews), [project, data.reviews]);
  const work = data.collaborations.filter(item => item.request.project_id === project.id);
  const task = data.task && (data.task.tracker?.project_id === project.id || data.task.team_budget?.project_id === project.id || data.task.budget_request?.project_id === project.id) ? data.task : null;
  const absence = data.absences.get(project.id);
  const agents = data.connections.filter(c => !c.revoked && c.document_grants?.some(g => g.project_id === project.id));
  const sources = [
    ...(mail.value?.connections ?? []).filter(c => c.project_id === project.id).map(c => ({ key: `mail/${c.connection_id}`, kind: "Почта", title: c.provider, note: c.enabled ? "чтение агентом · отправка письма только после согласования" : "отключено" })),
    ...(calendars.value?.connections ?? []).filter(c => c.project_id === project.id).map(c => ({ key: `cal/${c.connection_id}`, kind: "Календарь", title: `${c.provider} · ${c.calendar_id}`, note: c.enabled ? "чтение окна · встреча только после согласования черновика" : "отключено" })),
    ...(databases.value?.databases ?? []).filter(d => d.project_id === project.id).map(d => ({ key: `db/${d.db_id}`, kind: "База", title: `${d.name} · ${d.driver}`, note: d.unreachable_since ? `ошибка доступа с ${new Date(d.unreachable_since).toLocaleString("ru-RU")}` : "запросы агента только на чтение" })),
  ];
  const sourceErrors = [mail.error, calendars.error, databases.error].filter(Boolean);

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-lg font-semibold text-kumo-strong">{project.name}</h2>
          <p className="mt-1 mb-0 text-[12px] text-kumo-subtle">Документы: {materials.length}{project.truncated ? "+" : ""} · Обращения: {work.length} · Ваши агенты: {agents.length}</p>
        </div>
        <Button size="sm" onClick={() => { setActionError(""); void host.openPrompt(`Работаем над проектом «${project.name}» (ID: ${project.id}).\n\n`).catch(() => setActionError("Не удалось начать беседу. Повторите попытку.")); }}>Начать беседу</Button>
      </div>
      {actionError && <Notice tone="danger">{actionError}</Notice>}


      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={uploading} onClick={() => void upload(false)}><UploadSimple size={15} />Загрузить файлы</Button>
        <Button variant="ghost" size="sm" disabled={uploading} onClick={() => void upload(true)}>Выбрать папку</Button>
        {uploading && <span role="status" className="text-sm text-kumo-subtle">Загружаем в проект…</span>}
      </div>
      {uploaded.length > 0 && <div className="mb-5 text-sm" role="status">
        <p className="text-kumo-subtle">Принято файлов: {uploaded.filter(file => !file.error).length} из {uploaded.length}.</p>
        {uploaded.some(file => file.receipt?.placement_state === "personal") && <p>Файлы сохранены как личные черновики проекта. Для общего доступа их нужно опубликовать.</p>}
        {uploaded.filter(file => file.error).map((file, index) => <Notice key={index} tone="danger">{file.path}: {file.error}</Notice>)}
      </div>}
      <Block title="Материалы" count={materials.length} empty={project.nodesError ? "Документы проекта не прочитаны: проверьте доступ." : "Документов пока нет."}
        actions={<Button variant="ghost" size="sm" onClick={onOpenDocuments}>Все документы проекта</Button>}>
        <RowList>
          {materials.slice(0, MATERIALS_LIMIT).map(row => (
            <Row key={row.nodeId} data-document={row.nodeId}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-kumo-line bg-kumo-elevated text-kumo-subtle"><FileText size={14} aria-hidden="true" /></span>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-kumo-default hover:underline" onClick={() => {
                setActionError("");
                void host.openNativeDocument(project.id, row.nodeId).then(opened => { if (!opened) onOpenDocuments(); }).catch(() => setActionError("Не удалось открыть документ. Проверьте подключение и повторите попытку."));
              }}>{row.name}</button>
              <StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge>
            </Row>
          ))}
        </RowList>
        {materials.length > MATERIALS_LIMIT && <p className="mt-2 mb-0 text-[12px] text-kumo-subtle">Показаны первые {MATERIALS_LIMIT}; остальные — во вкладке «Документы».</p>}
      </Block>

      <details className="mt-6">
        <summary className="cursor-pointer py-2 text-sm text-kumo-subtle">Участники и настройки проекта</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => openLegacy({ kind: "tracker", project: project.id }, "Трекер проекта")}>Трекер</Button>
          <Button variant="secondary" size="sm" onClick={() => openLegacy({ kind: "policy", project: project.id }, "Настройка согласований")}>Настроить согласования</Button>
        </div>
        <Block title="Участники и направления" count={members.length} empty={policy.error || approvers.error || "Участники не назначены."}>
          <RowList>{members.map(member => <Row key={member.id}><RowText title={member.name} note={member.domains.length ? `Согласует направление ${member.domains.join(", ")}` : "Участник"} /></Row>)}</RowList>
        </Block>
      <Block title="Текущая работа" count={work.length + (task ? 1 : 0)} empty={data.collaborationsError || "Текущей работы нет: обращений и задач агентов по проекту не найдено."}
        actions={<Button variant="ghost" size="sm" onClick={() => openLegacy({ kind: "collaborations" }, "Обращения и обсуждения")}>Обращения</Button>}>
        <RowList>
          {task && (
            <Row>
              <RowText title={`Задача агента: ${task.message.slice(0, 80)}`} note={`ведёт агент ${task.binding_id}`} />
              <StatusBadge tone={task.outcome?.state === "completed" ? "warning" : "info"}>{task.outcome?.state === "completed" ? "Ждёт приёмки" : task.submitted ? "В работе" : "Не отправлена"}</StatusBadge>
            </Row>
          )}
          {work.map(item => (
            <Row key={item.request.request_id}>
              <RowText title={item.request.title} note={`ведёт ${item.request.target_agent_id ? `агент ${item.request.target_agent_id}` : item.request.target_user_id} · от ${item.request.requester_agent_id || item.request.requester_user_id} · документ ${nodeName(item.request.node_id)}`} />
              <StatusBadge tone={item.progress?.state === "accepted" ? "success" : item.progress?.state === "changes_requested" ? "danger" : "neutral"}>{item.progress ? COLLABORATION_STATES[item.progress.state] : "Состояние недоступно"}</StatusBadge>
            </Row>
          ))}
        </RowList>
      </Block>

      <Block title="Агенты проекта" count={agents.length} empty={data.connectionsError || "Ваших агентов нет."}
        actions={<Button variant="ghost" size="sm" onClick={() => openLegacy({ kind: "absence", project: project.id }, "Замещение на время отсутствия")}>Замещение</Button>}>
        <p className="mt-0 mb-2 text-[12px] text-kumo-subtle">Показаны ваши подключения; доступ каждого агента к проекту сервер проверяет при обращении, не шире ваших прав.</p>
        <RowList>
          {agents.map(agent => {
            const role = absence?.enabled && absence.local_binding_id === agent.binding_id ? "замещается" : absence?.enabled && absence.managed_binding_id === agent.binding_id ? `замещает до ${new Date(absence.ends_at).toLocaleString("ru-RU")}` : "";
            return (
              <Row key={agent.binding_id}>
                <RowText title={agent.agent_principal_id} note={`${agentEnvironment(agent)}${role ? ` · ${role}` : ""}`} />
              </Row>
            );
          })}
        </RowList>
      </Block>

      <Block title="Правила согласования" count={policy.value?.domains.length ?? 0} empty={policy.error || "Правил согласования нет: публикация в этом проекте не требует согласующих."}>
        <RowList>
          {(policy.value?.domains ?? []).map(domain => (
            <Row key={domain.domain_id}>
              <RowText title={domain.all_documents ? "Все документы проекта, включая новые" : domain.node_ids.map(nodeName).join(", ")} note={`согласуют: ${domain.approver_ids.map(id => names.get(id) ?? id).join(", ") || "никто не назначен"}`} />
              <StatusBadge tone="info">{domain.domain_id}</StatusBadge>
            </Row>
          ))}
        </RowList>
      </Block>

      <Block title="Источники проекта" count={sources.length} empty={sourceErrors.length ? `Источники не прочитаны: ${sourceErrors.join("; ")}.` : "К проекту не привязано ни одного источника."}
        actions={<Button variant="ghost" size="sm" onClick={onOpenSources}>Все источники</Button>}>
        {sourceErrors.length > 0 && <div className="mb-2"><Notice tone="danger">Часть источников не прочитана: {sourceErrors.join("; ")}.</Notice></div>}
        <RowList>
          {sources.map(source => (
            <Row key={source.key}>
              <StatusBadge tone="neutral">{source.kind}</StatusBadge>
              <RowText title={source.title} note={source.note} />
            </Row>
          ))}
        </RowList>
      </Block>
      </details>
    </div>
  );
}

function membersByDomain(policy: PublicationPolicy | null, names: Map<string, string>): { id: string; name: string; domains: string[] }[] {
  const byId = new Map<string, string[]>();
  for (const domain of policy?.domains ?? ([] as PolicyDomain[])) {
    for (const id of domain.approver_ids) byId.set(id, [...(byId.get(id) ?? []), domain.domain_id]);
  }
  for (const id of names.keys()) if (!byId.has(id)) byId.set(id, []);
  return [...byId].map(([id, domains]) => ({ id, name: names.get(id) ?? id, domains })).sort((a, b) => b.domains.length - a.domains.length || a.name.localeCompare(b.name, "ru"));
}

function CreateProject({ onCreated, onCancel }: { onCreated(id: string): Promise<void>; onCancel(): void }) {
  const ui = useUi();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState(() => "project-" + crypto.randomUUID().slice(0, 8));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (busy || !name.trim()) return;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug.trim())) { setError("Код проекта: латинские строчные буквы, цифры и дефисы."); return; }
    setBusy(true); setError("");
    try {
      const result = await ui.createProject(name.trim(), slug.trim());
      await onCreated(result.project.id);
    } catch {
      setError("Проект не создан или ответ не получен. Проверьте список проектов, имя и ваши полномочия перед повтором.");
    } finally { setBusy(false); }
  }
  // The management frame intentionally disallows native form submissions.
  return <form aria-label="Новый проект" onSubmit={e => e.preventDefault()} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}>
    <label>Название проекта<TextInput required maxLength={255} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
    <label>Код проекта<TextInput required maxLength={100} value={slug} onChange={e => setSlug(e.target.value)} disabled={busy} /></label>
    {error && <Notice tone="danger">{error}</Notice>}
    <Button type="button" onClick={() => void submit()} disabled={busy || !name.trim()}>Создать</Button>
    <Button type="button" disabled={busy} onClick={onCancel}>Отмена</Button>
  </form>;
}
