import { useState } from "react";
import type { ShareRequest } from "../src/project-sharing.ts";
import { useUi } from "./host.ts";
import { personName, projectSummary, useLoad, type MemoryData } from "./data.ts";
import { headedUnits, useOrgUnits } from "./Departments.tsx";
import { shareAudience } from "./MyWorkTab.tsx";
import { plural } from "./names.ts";
import PersonAvatar from "./PersonAvatar.tsx";
import { Button, Chip, Notice, PageHeader } from "./ui.tsx";
import { Card, CardRow, RowTitle, SectionHead } from "./admin-ui.tsx";
import { CaretRight, Folder, UserPlus } from "@phosphor-icons/react";
import { PrivateCodeApproval, privateCodeConsentNeeded } from "./ProjectSharing.tsx";
import { REPOSITORY_FAILURES } from "../src/git-repositories.ts";

/** «Мой отдел» — руководителю отдела и ответственному за проект: запросы «Поделиться», которые ждут
 * его решения, сотрудники и проекты. Права проверяет сервер при каждом действии. */
export default function TeamTab({ data, onOpenProject, onInvite }: { data: MemoryData; onOpenProject(project: string): void; onInvite?(): void }) {
  const ui = useUi();
  const userId = data.identity?.subject.user_id ?? "";
  const { units, loading: unitsLoading, failed: unitsFailed } = useOrgUnits();
  const shares = useLoad(async () => (await ui.listShareRequests(false)).requests.filter(r => r.status === "pending"), "Запросы на решение не загрузились. Обновите страницу.", [ui]);
  const [busy, setBusy] = useState("");
  const [privateCode, setPrivateCode] = useState<ShareRequest | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const mine = headedUnits(units, userId);
  const unitIds = new Set(mine.map(u => u.org_unit_id));
  const departmentProjects = data.projects.filter(p => p.orgUnit && unitIds.has(p.orgUnit));
  const responsible = new Set(data.identity?.roles?.responsible_projects ?? []);
  const responsibleProjects = data.projects.filter(p => responsible.has(p.id));
  const people = mine.reduce((n, u) => n + u.members.length, 0);

  async function decide(share: ShareRequest, approve: boolean, consent = false) {
    if (busy) return;
    setBusy(share.request_id); setNotice(null);
    try {
      await ui.decideShareRequest(share.request_id, approve, consent);
      setPrivateCode(null);
      setNotice({ tone: "success", text: approve ? `Проект «${share.project_name}» открыт ${shareAudience(share)}.` : `Запрос отклонён: проект «${share.project_name}» остаётся с прежним доступом.` });
      await shares.reload();
      await data.reloadProjects();
    } catch (e) {
      if (approve && !consent && privateCodeConsentNeeded(e)) setPrivateCode(share);
      else setNotice({ tone: "danger", text: e instanceof Error && e.message === REPOSITORY_FAILURES["project.private_code_admin"] ? "В проекте код приватного репозитория: всей организации его открывает только администратор." : "Решение не сохранено. Возможно, запрос уже решён или у вас больше нет права решать его." });
    } finally { setBusy(""); }
  }

  const summary = mine.length > 0
    ? `Вы руководите ${mine.length === 1 ? `отделом «${mine[0].name}»` : `отделами ${mine.map(u => `«${u.name}»`).join(", ")}`}.`
    : responsibleProjects.length > 0 ? `Вы отвечаете за ${responsibleProjects.length} ${plural(responsibleProjects.length, "проект", "проекта", "проектов")}.` : "";

  const pending = shares.value ?? [];
  return <div className="flex flex-col gap-7">
    <PageHeader title="Мой отдел" subtitle={summary || undefined}
      actions={mine.length > 0 && onInvite ? <Button size="md" icon={<UserPlus size={16} aria-hidden="true" />} onClick={onInvite}>Пригласить в отдел</Button> : undefined} />
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {privateCode && <PrivateCodeApproval share={privateCode} busy={!!busy} onConfirm={() => void decide(privateCode, true, true)} onCancel={() => setPrivateCode(null)} />}

    {/* Пустой раздел решений не занимает место: он появляется, только когда есть что решать. */}
    {(shares.error || pending.length > 0) && <section aria-label="Ждёт вашего решения">
      <SectionHead title="Ждёт вашего решения" />
      {shares.error && <Notice tone="danger">{shares.error}</Notice>}
      {pending.length > 0 && <Card>{pending.map(share => (
        <div key={share.request_id} data-team-share="" className="flex flex-wrap items-center gap-3 border-t border-kumo-fill px-4 py-3 first:border-t-0">
          <RowTitle title={`${share.requested_by_name || personName(share.requested_by)} хочет открыть проект «${share.project_name}» ${shareAudience(share)}`} note={share.can_edit ? "с правом править" : "только чтение"} />
          <div className="flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
            <Button size="sm" disabled={!!busy} onClick={() => void decide(share, true)}>Разрешить</Button>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void decide(share, false)}>Отклонить</Button>
          </div>
        </div>))}</Card>}
    </section>}

    <div className="grid items-start gap-7 md:grid-cols-2">
      {(unitsLoading || mine.length > 0 || unitsFailed) && <section aria-label="Сотрудники отдела" className="min-w-0">
        <SectionHead title="Сотрудники" count={unitsLoading || unitsFailed ? undefined : people} />
        {unitsLoading && <Notice>Загружаем отделы…</Notice>}
        {unitsFailed && <Notice tone="danger">Отделы не загрузились. Обновите страницу.</Notice>}
        {!unitsLoading && !unitsFailed && people === 0 && <Notice>В ваших отделах пока никого нет. Пригласите первого сотрудника.</Notice>}
        {people > 0 && <Card>{mine.flatMap(unit => unit.members.map(m => {
          const name = m.display_name || personName(m.principal_id);
          const role = m.is_head ? "руководитель" : "сотрудник";
          return <CardRow key={`${unit.org_unit_id}/${m.principal_id}`}>
            <PersonAvatar name={name} id={m.principal_id} />
            <RowTitle title={name} note={mine.length > 1 ? `${unit.name}, ${role}` : role} />
          </CardRow>;
        }))}</Card>}
      </section>}

      {mine.length > 0 && <section aria-label="Проекты отдела" className="min-w-0">
        <SectionHead title="Проекты отдела" count={departmentProjects.length} />
        {departmentProjects.length === 0 ? <Notice>У отдела пока нет общих проектов.</Notice> : <ProjectRows projects={departmentProjects} onOpen={onOpenProject} />}
      </section>}

      {responsibleProjects.length > 0 && <section aria-label="Вы отвечаете за проекты" className="min-w-0">
        <SectionHead title="Вы отвечаете за проекты" count={responsibleProjects.length} />
        <ProjectRows projects={responsibleProjects} onOpen={onOpenProject} />
      </section>}
    </div>

    {!unitsLoading && mine.length === 0 && responsibleProjects.length === 0 && !data.projectsLoading &&
      <Notice>Вы не руководите отделом и не отвечаете за проекты. Когда администратор назначит вас руководителем или ответственным, здесь появятся люди и проекты.</Notice>}
  </div>;
}

function ProjectRows({ projects, onOpen }: { projects: MemoryData["projects"]; onOpen(project: string): void }) {
  return <Card>{projects.map(project => (
    <button key={project.id} type="button" aria-label={`Открыть проект «${project.name}»`} onClick={() => onOpen(project.id)}
      className="flex w-full items-center gap-3 border-0 border-t border-solid border-kumo-fill bg-transparent px-4 py-3 text-left first:border-t-0 hover:bg-kumo-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-kumo-tint text-kumo-subtle"><Folder size={18} /></span>
      <RowTitle title={project.name} note={projectSummary(project) || undefined} />
      {project.pendingShare && <Chip tone="warning">Ждёт решения</Chip>}
      <CaretRight size={16} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
    </button>))}</Card>;
}
