import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { ShareRequest } from "../src/project-sharing.ts";
import { useUi } from "./host.ts";
import { personName, useLoad, type MemoryData } from "./data.ts";
import { headedUnits, useOrgUnits } from "./Departments.tsx";
import { shareAudience } from "./MyWorkTab.tsx";
import { Block, Notice, Row, RowList, RowText, StatusBadge } from "./ui.tsx";

/** «Мой отдел» — руководителю отдела и ответственному за проект: люди, проекты и запросы
 * «Поделиться», которые ждут его решения. Права проверяет сервер при каждом действии. */
export default function TeamTab({ data, onOpenProject }: { data: MemoryData; onOpenProject(project: string): void }) {
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

  const pending = shares.value ?? [];
  return <div className="grid gap-6">
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    <Block title="Ждут вашего решения" count={pending.length} empty={shares.loading || shares.error ? undefined : "Запросов «Поделиться» на решение нет."}>
      {shares.error && <Notice tone="danger">{shares.error}</Notice>}
      {pending.length > 0 && <RowList>{pending.map(share => (
        <Row key={share.request_id} className="items-start" data-team-share="">
          <RowText title={`${share.requested_by_name || personName(share.requested_by)} хочет открыть проект «${share.project_name}» ${shareAudience(share)}`}
            note={share.can_edit ? "с правом править" : "только чтение"} />
          <Button variant="primary" size="sm" disabled={!!busy} onClick={() => void decide(share, true)}>Подтвердить</Button>
          <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void decide(share, false)}>Отклонить</Button>
        </Row>))}</RowList>}
    </Block>

    {(unitsLoading || mine.length > 0 || unitsFailed) && <Block title="Сотрудники отдела" count={mine.reduce((n, u) => n + u.members.length, 0)} empty={unitsLoading || unitsFailed ? undefined : "В ваших отделах пока никого нет."}>
      {unitsLoading && <Notice>Загрузка отделов…</Notice>}
      {unitsFailed && <Notice tone="danger">Отделы недоступны. Обновите страницу.</Notice>}
      {mine.map(unit => <section key={unit.org_unit_id} aria-label={`Отдел ${unit.name}`} className="grid gap-2">
        {mine.length > 1 && <h3 className="m-0 text-[15px] font-semibold">{unit.name}</h3>}
        <RowList>{unit.members.map(m => (
          <Row key={m.principal_id}>
            <RowText title={m.display_name || personName(m.principal_id)} />
            {m.is_head && <StatusBadge tone="success">Руководитель</StatusBadge>}
          </Row>))}</RowList>
      </section>)}
    </Block>}

    {mine.length > 0 && <Block title="Проекты отдела" count={departmentProjects.length} empty="У отдела пока нет общих проектов.">
      {departmentProjects.length > 0 && <ProjectRows projects={departmentProjects} onOpen={onOpenProject} />}
    </Block>}

    {responsibleProjects.length > 0 && <Block title="Вы отвечаете за проекты" count={responsibleProjects.length}>
      <ProjectRows projects={responsibleProjects} onOpen={onOpenProject} />
    </Block>}

    {!unitsLoading && mine.length === 0 && responsibleProjects.length === 0 && !data.projectsLoading &&
      <Notice>Вы не руководите отделом и не отвечаете за проекты. Когда администратор назначит вас руководителем или ответственным, здесь появятся люди и проекты.</Notice>}
  </div>;
}

function ProjectRows({ projects, onOpen }: { projects: MemoryData["projects"]; onOpen(project: string): void }) {
  return <RowList>{projects.map(project => (
    <Row key={project.id}>
      <RowText title={project.name} note={project.pendingShare ? "ждёт решения о доступе" : undefined} />
      <Button variant="ghost" size="sm" aria-label={`Открыть проект «${project.name}»`} onClick={() => onOpen(project.id)}>Открыть</Button>
    </Row>))}</RowList>;
}
