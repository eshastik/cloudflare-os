import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { PublicationReview } from "../src/mnemos-api.ts";
import { formatBudgetUSD } from "../app/budget-money.ts";
import { useHost, useUi } from "./host.ts";
import { agentEnvironment, documentNames, myApprovals, projectName, useLoad, type CollaborationItem, type MemoryData } from "./data.ts";
import { ApprovalRow, useReviewDecision } from "./ApprovalsTab.tsx";
import { LegacySwitch, useLegacySection } from "./legacy.tsx";
import { Block, Notice, Row, RowList, RowText, StatusBadge } from "./ui.tsx";

const COLLABORATION_STATES = { awaiting_result: "В работе", awaiting_review: "Ждёт приёмки", accepted: "Принято", changes_requested: "На доработке" } as const;

/** Предложения текущего человека, которые все согласующие приняли: их можно публиковать. */
function readyToPublish(reviews: PublicationReview[], userId: string): PublicationReview[] {
  return reviews.filter(review => review.author_id === userId && review.ready && !review.stale);
}

/** Предложения текущего человека, которые ждут чужих решений. */
function blockedReviews(reviews: PublicationReview[], userId: string): { review: PublicationReview; waitingFor: string[]; domains: string[] }[] {
  const out: { review: PublicationReview; waitingFor: string[]; domains: string[] }[] = [];
  for (const review of reviews) {
    if (review.author_id !== userId || review.ready || review.stale) continue;
    const waitingFor: string[] = [], domains: string[] = [];
    for (const domain of review.domains) {
      const undecided = domain.approvers.filter(id => !domain.decisions.some(d => d.approver_id === id));
      if (!undecided.length) continue;
      domains.push(domain.domain_id); waitingFor.push(...undecided);
    }
    if (waitingFor.length) out.push({ review, waitingFor: [...new Set(waitingFor)], domains });
  }
  return out;
}

export default function MyWorkTab({ data }: { data: MemoryData }) {
  const ui = useUi();
  const host = useHost();
  const legacy = useLegacySection();
  const decision = useReviewDecision(data);
  const [publishNotice, setPublishNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [publishing, setPublishing] = useState("");
  const userId = data.identity?.subject.user_id ?? "";
  const names = documentNames(data.projects);
  const docs = (review: PublicationReview) => review.domains.flatMap(d => d.node_ids).map(id => names.get(`${review.project_id}/${id}`) ?? id).join(", ");

  const approvals = userId ? myApprovals(data.reviews, userId).filter(item => item.mine === null && !item.review.stale) : [];
  const publishable = userId ? readyToPublish(data.reviews, userId) : [];
  const reviewCollaborations = data.collaborations.filter(item => item.request.requester_user_id === userId && item.progress?.state === "awaiting_review");
  const assigned = data.collaborations.filter(item => item.request.target_user_id === userId && !item.request.target_agent_id && item.request.requester_user_id !== userId);
  const agents = data.connections.filter(c => !c.revoked);
  const blocked = userId ? blockedReviews(data.reviews, userId) : [];
  const waitingCollaborations = data.collaborations.filter(item => item.request.requester_user_id === userId && item.progress?.state === "awaiting_result");
  const budgetBlocked = data.task && data.task.team_budget && !data.task.submitted ? data.task : null;

  const task = data.task;
  const usage = useLoad(async () => task?.team_budget ? ui.readTeamBudgetUsage(task.team_budget.project_id, task.team_budget.proposal_id) : null, "расход не прочитан", [task?.team_budget?.proposal_id, ui]);

  async function publish(review: PublicationReview) {
    setPublishing(review.candidate_id); setPublishNotice(null);
    try {
      const state = await ui.draftState(review.project_id);
      if (state.personal_head !== review.personal_head || state.shared_head !== review.shared_head) throw new Error("changed");
      const result = await ui.publishDraft(review.project_id, state.personal_head, state.shared_head, "Publish reviewed changes");
      setPublishNotice(result.published
        ? { tone: "success", text: "Изменения проекта опубликованы." }
        : result.conflicted ? { tone: "danger", text: "При публикации обнаружен конфликт. Откройте черновик и разрешите его." } : { tone: "danger", text: "Публикация не выполнена. Проверьте состояние черновика." });
      await data.reloadReviews();
    } catch {
      setPublishNotice({ tone: "danger", text: "Публикация не подтверждена: версия черновика или права могли измениться. Откройте документ и проверьте состояние." });
    } finally {
      setPublishing("");
    }
  }

  const decisionsCount = approvals.length + publishable.length + reviewCollaborations.length;
  const blockedCount = blocked.length + waitingCollaborations.length + (budgetBlocked ? 1 : 0);

  return (
    <LegacySwitch state={legacy}>
      <div className="mb-4 flex items-center gap-2">
        <p className="m-0 flex-1 text-[12px] text-kumo-subtle">Что ждёт вашего решения, что поручено вам, чем заняты ваши агенты и что стоит.</p>
        <Button variant="secondary" size="sm" onClick={() => legacy.open({ kind: "uploadUsage" }, "Мои загрузки")}>Мои загрузки</Button>
        <Button variant="secondary" size="sm" onClick={() => legacy.open({ kind: "collaborations" }, "Обращения и обсуждения")}>Поручить</Button>
      </div>

      <Block title="Ждут моего решения" count={decisionsCount}>
        <Button variant="secondary" size="sm" onClick={() => void host.openApprovals().catch(() => setPublishNotice({tone:"danger",text:"Очередь не открылась. Обновите оболочку."}))}>Действия агентов — открыть очередь разрешений</Button>

        {decisionsCount === 0 && <Notice>Ничего не ждёт: решений за вами нет.</Notice>}
        {decision.notice && <div className="mb-2"><Notice tone={decision.notice.tone}>{decision.notice.text}</Notice></div>}
        {publishNotice && <div className="mb-2"><Notice tone={publishNotice.tone}>{publishNotice.text}</Notice></div>}
        {data.reviewsError && <div className="mb-2"><Notice tone="danger">{data.reviewsError}</Notice></div>}
        {decisionsCount > 0 && <RowList>
          {approvals.map(item => <ApprovalRow key={`${item.review.candidate_id}/${item.domain.domain_id}`} item={item} data={data} busy={decision.busy} decide={(i, a) => void decision.decide(i, a)} />)}
          {publishable.map(review => (
            <Row key={review.candidate_id} className="items-start" data-decision="publish">
              <StatusBadge tone="success">Публикация</StatusBadge>
              <RowText title={<>«{docs(review)}» — все согласующие приняли, можно публиковать</>} note={<>{projectName(data.projects, review.project_id)} · {review.domains.map(d => d.domain_id).join(", ")} · вы — владелец черновика</>} />
              <Button variant="primary" size="sm" disabled={publishing === review.candidate_id} onClick={() => void publish(review)}>Опубликовать</Button>
            </Row>
          ))}
          {reviewCollaborations.map(item => (
            <Row key={item.request.request_id} className="items-start" data-decision="collaboration">
              <StatusBadge tone="warning">Приёмка</StatusBadge>
              <RowText title={<>«{item.request.title}» — результат обращения ждёт вашей приёмки</>} note={<>{projectName(data.projects, item.request.project_id)} · исполнитель {item.request.target_agent_id || item.request.target_user_id}</>} />
              <Button variant="secondary" size="sm" onClick={() => legacy.open({ kind: "collaborations" }, "Обращения и обсуждения")}>Открыть</Button>
            </Row>
          ))}
        </RowList>}
      </Block>

      <Block title="Поручено мне" count={assigned.length} empty={data.collaborationsError || "Ничего не ждёт: поручений вам нет."}>
        <RowList>{assigned.map(item => <CollaborationRow key={item.request.request_id} item={item} data={data} onOpen={() => legacy.open({ kind: "collaborations" }, "Обращения и обсуждения")} />)}</RowList>
      </Block>

      <Block title="Мои агенты" count={agents.length} empty={data.connectionsError || "Ничего не ждёт: подключённых агентов нет."}
        actions={<><Button variant="ghost" size="sm" onClick={() => legacy.open({ kind: "taskHistory" }, "История задач агента")}>История задач</Button><Button variant="ghost" size="sm" onClick={() => legacy.open({ kind: "budget" }, "Бюджет проекта")}>Бюджеты</Button></>}>
        {data.taskError && <div className="mb-2"><Notice tone="danger">{data.taskError}</Notice></div>}
        <RowList>
          {agents.map(agent => {
            const current = task && task.binding_id === agent.binding_id ? task : null;
            const absence = [...data.absences.values()].find(a => a.enabled && (a.local_binding_id === agent.binding_id || a.managed_binding_id === agent.binding_id));
            const state = current ? (current.outcome?.state === "completed" ? "Ждёт приёмки" : current.outcome?.state === "budget_blocked" ? "Остановлен бюджетом" : current.submitted ? "Работает" : "Задача не отправлена") : "Ожидает";
            return (
              <Row key={agent.binding_id} className="items-start" data-agent={agent.binding_id}>
                <RowText title={<>{agent.agent_principal_id} · {agentEnvironment(agent)}</>} note={<>
                  {current ? `Задача: ${current.message.slice(0, 80)}` : "Текущей задачи нет"}
                  {current?.team_budget && usage.value && ` · расход ${formatBudgetUSD(usage.value.actual_usd_micros)} $`}
                  {current?.team_budget && usage.error && ` · ${usage.error}`}
                  {absence && ` · замещение до ${new Date(absence.ends_at).toLocaleString("ru-RU")}`}
                </>} />
                <StatusBadge tone={state === "Работает" ? "info" : state === "Ждёт приёмки" ? "warning" : "neutral"}>{state}</StatusBadge>
              </Row>
            );
          })}
        </RowList>
      </Block>

      <Block title="Заблокировано" count={blockedCount} empty="Ничего не ждёт: чужих решений вы не ждёте.">
        <RowList>
          {blocked.map(({ review, waitingFor, domains }) => (
            <Row key={review.candidate_id} className="items-start">
              <RowText title={<>«{docs(review)}» ждёт согласования по направлению {domains.join(", ")}</>} note={<>{projectName(data.projects, review.project_id)} · разблокировать может {waitingFor.join(", ")}</>} />
            </Row>
          ))}
          {waitingCollaborations.map(item => (
            <Row key={item.request.request_id} className="items-start">
              <RowText title={<>Обращение «{item.request.title}» ждёт результата</>} note={<>{projectName(data.projects, item.request.project_id)} · разблокировать может {item.request.target_agent_id || item.request.target_user_id}</>} />
              <Button variant="secondary" size="sm" onClick={() => legacy.open({ kind: "collaborations" }, "Обращения и обсуждения")}>Открыть</Button>
            </Row>
          ))}
          {budgetBlocked && (
            <Row className="items-start">
              <RowText title="Задача агента ждёт согласования бюджета" note={<>{projectName(data.projects, budgetBlocked.team_budget!.project_id)} · заявка {budgetBlocked.team_budget!.proposal_id} · разблокировать может владелец бюджета проекта</>} />
              <Button variant="secondary" size="sm" onClick={() => legacy.open({ kind: "agentTask" }, "Задача агенту")}>Открыть</Button>
            </Row>
          )}
        </RowList>
      </Block>
    </LegacySwitch>
  );
}

function CollaborationRow({ item, data, onOpen }: { item: CollaborationItem; data: MemoryData; onOpen: () => void }) {
  const state = item.progress ? COLLABORATION_STATES[item.progress.state] : "Состояние недоступно";
  return (
    <Row className="items-start" data-collaboration={item.request.request_id}>
      <RowText title={item.request.title} note={<>{projectName(data.projects, item.request.project_id)} · от {item.request.requester_agent_id || item.request.requester_user_id} · срок не задан</>} />
      <StatusBadge tone={item.progress?.state === "accepted" ? "success" : item.progress?.state === "changes_requested" ? "danger" : "neutral"}>{state}</StatusBadge>
      <Button variant="secondary" size="sm" onClick={onOpen}>Открыть</Button>
    </Row>
  );
}
