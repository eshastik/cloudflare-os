import { useState } from "react";
import type { ShareRequest } from "../src/project-sharing.ts";
import { useUi } from "./host.ts";
import { personName, useLoad, type MemoryData } from "./data.ts";
import { headedUnits, useOrgUnits } from "./Departments.tsx";
import { shareAudience } from "./MyWorkTab.tsx";
import { plural } from "./names.ts";
import { Avatar, Button, Chip, Notice, PageHeader } from "./ui.tsx";

/** «Мой отдел» — руководителю отдела и ответственному за проект: запросы «Поделиться», которые ждут
 * его решения, сотрудники и проекты. Права проверяет сервер при каждом действии. */
export default function TeamTab({ data, onOpenProject, onInvite }: { data: MemoryData; onOpenProject(project: string): void; onInvite?(): void }) {
  const ui = useUi();
  const userId = data.identity?.subject.user_id ?? "";
  const { units, loading: unitsLoading, failed: unitsFailed } = useOrgUnits();
  const shares = useLoad(async () => (await ui.listShareRequests(false)).requests.filter(r => r.status === "pending"), "Запросы на решение не загрузились. Обновите страницу.", [ui]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const mine = headedUnits(units, userId);
  const unitIds = new Set(mine.map(u => u.org_unit_id));
  const departmentProjects = data.projects.filter(p => p.orgUnit && unitIds.has(p.orgUnit));
  const responsible = new Set(data.identity?.roles?.responsible_projects ?? []);
  const responsibleProjects = data.projects.filter(p => responsible.has(p.id));
  const people = mine.reduce((n, u) => n + u.members.length, 0);

  async function decide(share: ShareRequest, approve: boolean) {
    if (busy) return;
    setBusy(share.request_id); setNotice(null);
    try {
      await ui.decideShareRequest(share.request_id, approve);
      setNotice({ tone: "success", text: approve ? `Проект «${share.project_name}» открыт ${shareAudience(share)}.` : `Запрос отклонён: проект «${share.project_name}» остаётся с прежним доступом.` });
      await shares.reload();
      await data.reloadProjects();
    } catch {
      setNotice({ tone: "danger", text: "Решение не сохранено. Возможно, запрос уже решён или у вас больше нет права решать его." });
    } finally { setBusy(""); }
  }

  const summary = mine.length > 0
    ? [mine.length === 1 ? `Отдел «${mine[0].name}»` : `Отделы: ${mine.map(u => `«${u.name}»`).join(", ")}`, "вы руководитель",
        `${people} ${plural(people, "сотрудник", "сотрудника", "сотрудников")}`, `${departmentProjects.length} ${plural(departmentProjects.length, "проект", "проекта", "проектов")}`].join(" · ")
    : responsibleProjects.length > 0 ? `Вы отвечаете за ${responsibleProjects.length} ${plural(responsibleProjects.length, "проект", "проекта", "проектов")}` : "";

  const pending = shares.value ?? [];
  return <div className="flex flex-col gap-7">
    <PageHeader title="Мой отдел" subtitle={summary || undefined}
      actions={mine.length > 0 && onInvite ? <Button size="md" onClick={onInvite}>Пригласить в отдел</Button> : undefined} />
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

    <section aria-label="Ждёт вашего решения" className="flex flex-col gap-2.5">
      <h2 className="m-0 text-[17px] font-semibold text-kumo-default">Ждёт вашего решения</h2>
      {shares.error && <Notice tone="danger">{shares.error}</Notice>}
      {!shares.loading && !shares.error && pending.length === 0 && <Notice>Запросов «Поделиться» на решение нет.</Notice>}
      {pending.map(share => (
        <div key={share.request_id} data-team-share="" className="flex flex-wrap items-center gap-3.5 rounded-[16px] border border-kumo-fill bg-kumo-overlay px-[18px] py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] leading-[22px] text-kumo-default">{`${share.requested_by_name || personName(share.requested_by)} хочет открыть проект «${share.project_name}» ${shareAudience(share)}`}</div>
            <div className="text-[13px] text-kumo-subtle">{share.can_edit ? "с правом править" : "только чтение"}</div>
          </div>
          <Button disabled={!!busy} onClick={() => void decide(share, true)}>Разрешить</Button>
          <Button variant="secondary" disabled={!!busy} onClick={() => void decide(share, false)}>Отклонить</Button>
        </div>))}
    </section>

    <div className="grid gap-8 md:grid-cols-2">
      {(unitsLoading || mine.length > 0 || unitsFailed) && <section aria-label="Сотрудники отдела">
        <h2 className="m-0 mb-2.5 text-[17px] font-semibold text-kumo-default">Сотрудники</h2>
        {unitsLoading && <Notice>Загрузка отделов…</Notice>}
        {unitsFailed && <Notice tone="danger">Отделы недоступны. Обновите страницу.</Notice>}
        {!unitsLoading && !unitsFailed && people === 0 && <Notice>В ваших отделах пока никого нет.</Notice>}
        {mine.map(unit => <div key={unit.org_unit_id} aria-label={`Отдел ${unit.name}`} role="group">
          {mine.length > 1 && <h3 className="m-0 mt-3 mb-1 text-[13px] font-medium text-kumo-subtle">{unit.name}</h3>}
          {unit.members.map(m => {
            const name = m.display_name || personName(m.principal_id);
            return <div key={m.principal_id} className="flex items-center gap-3 border-b border-kumo-fill py-[11px]">
              <Avatar name={name} />
              <span className="min-w-0 flex-1 truncate text-[15px] text-kumo-default">{name}</span>
              {m.is_head && <Chip tone="brand">Руководитель</Chip>}
            </div>;
          })}
        </div>)}
      </section>}

      {mine.length > 0 && <section aria-label="Проекты отдела">
        <h2 className="m-0 mb-2.5 text-[17px] font-semibold text-kumo-default">Проекты отдела</h2>
        {departmentProjects.length === 0 ? <Notice>У отдела пока нет общих проектов.</Notice> : <ProjectRows projects={departmentProjects} onOpen={onOpenProject} />}
      </section>}

      {responsibleProjects.length > 0 && <section aria-label="Вы отвечаете за проекты">
        <h2 className="m-0 mb-2.5 text-[17px] font-semibold text-kumo-default">Вы отвечаете за проекты</h2>
        <ProjectRows projects={responsibleProjects} onOpen={onOpenProject} />
      </section>}
    </div>

    {!unitsLoading && mine.length === 0 && responsibleProjects.length === 0 && !data.projectsLoading &&
      <Notice>Вы не руководите отделом и не отвечаете за проекты. Когда администратор назначит вас руководителем или ответственным, здесь появятся люди и проекты.</Notice>}
  </div>;
}

function ProjectRows({ projects, onOpen }: { projects: MemoryData["projects"]; onOpen(project: string): void }) {
  return <div>{projects.map(project => (
    <button key={project.id} type="button" aria-label={`Открыть проект «${project.name}»`} onClick={() => onOpen(project.id)}
      className="flex w-full items-center gap-3 border-0 border-b border-solid border-kumo-fill bg-transparent px-0 py-[11px] text-left hover:text-kumo-brand">
      <span className="min-w-0 flex-1 truncate text-[15px]">{project.name}</span>
      {project.pendingShare && <Chip tone="warning">ждёт решения о доступе</Chip>}
    </button>))}</div>;
}
