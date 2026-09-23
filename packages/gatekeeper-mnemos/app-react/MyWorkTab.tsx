import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo";
import { LockOpen, PaperPlaneTilt, Robot, SquaresFour, Stamp, Tray } from "@phosphor-icons/react";
import type { PublicationReview } from "../src/mnemos-api.ts";
import type { ShareRequest } from "../src/project-sharing.ts";
import { INBOX_FILTER, inboxEntries, type InboxAlert, type InboxEntry, type InboxFilter, type InboxKind } from "../src/inbox-count.ts";
import { useHost, useUi } from "./host.ts";
import { actorName, documentNames, myApprovals, personName, projectName, UNNAMED_DOCUMENT, useLoad, type CollaborationItem, type MemoryData } from "./data.ts";
import { ApprovalRow, useReviewDecision } from "./ApprovalsTab.tsx";
import ReviewDetails from "./ReviewDetails.tsx";
import ProjectIntake from "./ProjectIntake.tsx";
import { TemplateProposal, loadTemplateReviews } from "./TemplateApprovals.tsx";
import { LegacySwitch, useLegacySection } from "./legacy.tsx";
import { relativeTime } from "./time.ts";
import { Block, EmptyTab, Notice, Row, RowList, RowText, StatusBadge, type BadgeTone } from "./ui.tsx";

const COLLABORATION_STATES = { awaiting_result: "В работе", awaiting_review: "Ждёт приёмки", accepted: "Принято", changes_requested: "На доработке" } as const;
/** Сколько проектов опрашивать на вопросы приёмной; столько же берёт счётчик в навигации. */
const ALERT_PROJECTS = 10;

type Filter = "all" | InboxFilter;
const FILTERS: { id: Filter; title: string }[] = [
  { id: "all", title: "Все" }, { id: "approvals", title: "Согласования" }, { id: "agents", title: "Работа агентов" },
  { id: "intake", title: "Приём данных" }, { id: "access", title: "Доступ" },
];
const KIND: Record<InboxKind, { icon: ReactNode; badge: string; tone: BadgeTone }> = {
  approval: { icon: <Stamp size={16} aria-hidden="true" />, badge: "Согласование", tone: "warning" },
  publish: { icon: <PaperPlaneTilt size={16} aria-hidden="true" />, badge: "Можно публиковать", tone: "success" },
  template: { icon: <SquaresFour size={16} aria-hidden="true" />, badge: "Шаблон", tone: "warning" },
  acceptance: { icon: <Robot size={16} aria-hidden="true" />, badge: "Ждёт приёмки", tone: "warning" },
  intake: { icon: <Tray size={16} aria-hidden="true" />, badge: "Вопрос по файлу", tone: "info" },
  share: { icon: <LockOpen size={16} aria-hidden="true" />, badge: "Доступ к проекту", tone: "info" },
};

/** Кому откроется проект: отдел по имени, если сервер его назвал. */
export function shareAudience(share: Pick<ShareRequest, "level" | "org_unit_name">): string {
  if (share.level === "organization") return "всей организации";
  if (share.level === "department") return share.org_unit_name ? `отделу «${share.org_unit_name}»` : "своему отделу";
  return "только себе";
}
/** Чьё решение ждёт запрос на видимость. */
export function shareDecider(share: Pick<ShareRequest, "decider">): string {
  return share.decider === "admin" ? "администратора" : "руководителя отдела";
}

/** Предложения текущего человека, которые ждут чужих решений. */
function blockedReviews(reviews: PublicationReview[], userId: string): { review: PublicationReview; waitingFor: string[]; domains: string[] }[] {
  const out: { review: PublicationReview; waitingFor: string[]; domains: string[] }[] = [];
  for (const review of reviews) {
    if (review.author_id !== userId || review.ready || review.stale || review.withdrawn) continue;
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

interface Card { title: string; from: string; project: string; extra: string; chat?: string; chatProject?: string }

/** «Входящие»: всё, что ждёт решения человека, карточками. «Согласования» — тот же список с фильтром. */
export default function MyWorkTab({ data, initialFilter = "all" }: { data: MemoryData; initialFilter?: Filter }) {
  const ui = useUi();
  const host = useHost();
  const legacy = useLegacySection();
  const decision = useReviewDecision(data);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selectedKey, setSelectedKey] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [publishing, setPublishing] = useState("");
  const [sharing, setSharing] = useState("");
  const userId = data.identity?.subject.user_id ?? "";
  const names = useMemo(() => documentNames(data.projects), [data.projects]);
  const projectIds = data.projects.slice(0, ALERT_PROJECTS).map(p => p.id);

  const templates = useLoad(() => loadTemplateReviews(ui), "Согласования шаблонов не прочитаны.", [ui]);
  const alerts = useLoad(async (): Promise<InboxAlert[]> => {
    const pages = await Promise.all(projectIds.map(async project => (await ui.inboxAlerts(false, project).catch(() => ({ alerts: [] }))).alerts.map(alert => ({ project, alert }))));
    return pages.flat();
  }, "Вопросы приёмной не прочитаны.", [ui, projectIds.join(",")]);
  // Установка без видимости проектов или отказ — запросов просто нет: это не ошибка человека.
  const shares = useLoad(async () => (await ui.listShareRequests(false).catch(() => ({ requests: [] as ShareRequest[] }))).requests, "", [ui]);
  const myShares = useLoad(async () => (await ui.listShareRequests(true).catch(() => ({ requests: [] as ShareRequest[] }))).requests.filter(r => r.status === "pending"), "", [ui]);

  const entries = inboxEntries({ reviews: data.reviews, collaborations: data.collaborations, templates: templates.value ?? [], alerts: alerts.value ?? [], shares: shares.value ?? [] }, userId);
  const counts = new Map<Filter, number>([["all", entries.length]]);
  for (const entry of entries) counts.set(INBOX_FILTER[entry.kind], (counts.get(INBOX_FILTER[entry.kind]) ?? 0) + 1);
  const visible = filter === "all" ? entries : entries.filter(entry => INBOX_FILTER[entry.kind] === filter);
  const selected = visible.find(entry => entry.key === selectedKey) ?? null;

  const assigned = data.collaborations.filter(item => item.request.target_user_id === userId && !item.request.target_agent_id && item.request.requester_user_id !== userId);
  const blocked = userId ? blockedReviews(data.reviews, userId) : [];
  const waitingCollaborations = data.collaborations.filter(item => item.request.requester_user_id === userId && item.progress?.state === "awaiting_result");
  const budgetBlocked = data.task && data.task.team_budget && !data.task.submitted ? data.task : null;
  const finished = userId ? myApprovals(data.reviews, userId).filter(item => item.mine !== null || item.review.stale || item.review.withdrawn) : [];
  const waitingShares = myShares.value ?? [];
  const openCollaborations = () => legacy.open({ kind: "collaborations" }, "Обращения и обсуждения");

  async function publish(review: PublicationReview) {
    setPublishing(review.candidate_id); setNotice(null);
    try {
      const state = await ui.draftState(review.project_id);
      if (state.personal_head !== review.personal_head || state.shared_head !== review.shared_head) throw new Error("changed");
      const result = await ui.publishDraft(review.project_id, state.personal_head, state.shared_head, "Publish reviewed changes");
      setNotice(result.published
        ? { tone: "success", text: "Изменения проекта опубликованы." }
        : result.conflicted ? { tone: "danger", text: "При публикации обнаружен конфликт. Откройте черновик и разрешите его." } : { tone: "danger", text: "Публикация не выполнена. Проверьте состояние черновика." });
      await data.reloadReviews();
    } catch {
      setNotice({ tone: "danger", text: "Публикация не подтверждена: версия черновика или права могли измениться. Откройте документ и проверьте состояние." });
    } finally {
      setPublishing("");
    }
  }
  async function decideShare(share: ShareRequest, approve: boolean) {
    if (sharing) return;
    setSharing(share.request_id); setNotice(null);
    try {
      await ui.decideShareRequest(share.request_id, approve);
      setNotice({ tone: "success", text: approve ? `Проект «${share.project_name}» открыт ${shareAudience(share)}.` : `Запрос отклонён: проект «${share.project_name}» остаётся с прежним доступом.` });
      setSelectedKey("");
      await shares.reload();
      if (approve) await data.reloadProjects();
    } catch {
      setNotice({ tone: "danger", text: "Решение не записано: запрос мог быть уже решён или у вас нет права решать его. Обновите список." });
    } finally { setSharing(""); }
  }
  function chat(prompt: string, project?: string) {
    const title = project ? projectName(data.projects, project) : "";
    void host.openPrompt(prompt, project ? { projectId: project, title } : undefined).catch(() => setNotice({ tone: "danger", text: "Беседа не открылась. Повторите попытку." }));
  }

  const docs = (review: PublicationReview, nodes: string[] = review.domains.flatMap(d => d.node_ids)) => nodes.map(id => names.get(`${review.project_id}/${id}`) || UNNAMED_DOCUMENT).join(", ");
  function describe(entry: InboxEntry): Card {
    switch (entry.kind) {
      case "approval": {
        const r = entry.review!, d = entry.domain!, project = projectName(data.projects, r.project_id);
        return { title: `Согласовать «${docs(r, d.node_ids)}»`, from: personName(r.author_id), project, extra: `направление ${d.domain_id} · одобрили ${d.decisions.filter(x => x.approved).length} из ${d.approvers.length}`,
          chat: `Помоги проверить изменения в «${docs(r, d.node_ids)}» перед согласованием: что поменялось и есть ли риски?`, chatProject: r.project_id };
      }
      case "publish": {
        const r = entry.review!;
        return { title: `«${docs(r)}» можно публиковать`, from: "все согласующие одобрили", project: projectName(data.projects, r.project_id), extra: `направление ${r.domains.map(d => d.domain_id).join(", ")}` };
      }
      case "acceptance": {
        const r = entry.collaboration!.request;
        return { title: `Принять работу «${r.title}»`, from: actorName(data.connections, r.target_agent_id, r.target_user_id), project: projectName(data.projects, r.project_id), extra: "результат готов",
          chat: `Помоги проверить результат работы «${r.title}»: всё ли сделано по задаче?`, chatProject: r.project_id };
      }
      case "template": {
        const p = entry.template!.review.proposal;
        return { title: `Новый шаблон: ${p.message || "без описания"}`, from: personName(p.user_id), project: "", extra: `для «${entry.template!.scope.name}»` };
      }
      case "intake": {
        const a = entry.alert!.alert, file = a.paths[0] ?? "файл";
        return { title: `Куда положить «${file}»?`, from: "приёмная", project: projectName(data.projects, entry.alert!.project), extra: a.suggested_domain ? `предложена область «${a.suggested_domain}»` : "",
          chat: `Помоги решить, куда положить файл «${file}».`, chatProject: entry.alert!.project };
      }
      case "share": {
        const s = entry.share!;
        return { title: `${s.requested_by_name || personName(s.requested_by)} хочет открыть проект «${s.project_name}» ${shareAudience(s)}`, from: s.requested_by_name || personName(s.requested_by), project: s.project_name,
          extra: s.can_edit ? "видящие смогут править" : "видящие смогут только читать" };
      }
    }
  }
  function primary(entry: InboxEntry): ReactNode {
    switch (entry.kind) {
      case "approval": {
        const key = `${entry.review!.candidate_id}/${entry.domain!.domain_id}`;
        return <Button variant="primary" size="sm" disabled={decision.busy === key} onClick={() => void decision.decide({ review: entry.review!, domain: entry.domain!, mine: null }, true)}>Одобрить</Button>;
      }
      case "publish": return <Button variant="primary" size="sm" disabled={publishing === entry.review!.candidate_id} onClick={() => void publish(entry.review!)}>Опубликовать</Button>;
      case "acceptance": return <Button variant="primary" size="sm" onClick={openCollaborations}>Проверить результат</Button>;
      case "template": return <Button variant="primary" size="sm" onClick={() => setSelectedKey(entry.key)}>Рассмотреть</Button>;
      case "intake": return <Button variant="primary" size="sm" onClick={() => setSelectedKey(entry.key)}>Решить</Button>;
      case "share": return <>
        <Button variant="primary" size="sm" disabled={!!sharing} onClick={() => void decideShare(entry.share!, true)}>Разрешить</Button>
        <Button variant="secondary" size="sm" disabled={!!sharing} onClick={() => void decideShare(entry.share!, false)}>Отклонить</Button>
      </>;
    }
  }

  const errors = [data.reviewsError, data.collaborationsError, templates.error, alerts.error].filter(Boolean);
  const loading = data.reviewsLoading || templates.loading || alerts.loading || shares.loading;

  return (
    <LegacySwitch state={legacy}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Что показать" className="flex flex-1 flex-wrap gap-1">
          {FILTERS.filter(f => f.id === "all" || (counts.get(f.id) ?? 0) > 0).map(f => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setSelectedKey(""); }}
              className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ${filter === f.id ? "bg-kumo-fill font-medium text-kumo-strong" : "text-kumo-default hover:bg-kumo-tint"}`}>
              {f.title}<span className="rounded-full bg-kumo-fill px-1.5 text-[11px] leading-4 font-medium text-kumo-subtle">{counts.get(f.id) ?? 0}</span>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void host.openApprovals().catch(() => setNotice({ tone: "danger", text: "Разрешения агентов не открылись. Обновите страницу." }))}>Разрешения агентов</Button>
        <Button variant="ghost" size="sm" onClick={openCollaborations}>Поручить</Button>
        <Button variant="ghost" size="sm" onClick={() => legacy.open({ kind: "uploadUsage" }, "Мои загрузки")}>Мои загрузки</Button>
      </div>

      {decision.notice && <div className="mb-2"><Notice tone={decision.notice.tone}>{decision.notice.text}</Notice></div>}
      {notice && <div className="mb-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      {errors.map(error => <div key={error} className="mb-2"><Notice tone="danger">{error}</Notice></div>)}

      <div className={selected ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]" : ""}>
        <section aria-label="Ждёт решения" className="mb-6 min-w-0">
          {visible.length === 0
            ? (loading ? <Notice>Загрузка…</Notice> : <EmptyTab description="Сейчас ничего не ждёт вашего решения. Здесь появятся согласования, результаты работы агентов, запросы доступа к проектам и вопросы по загруженным материалам." />)
            : <div className="grid gap-3">{visible.map(entry => {
              const card = describe(entry);
              const age = relativeTime(entry.at);
              const meta = [card.from && `От: ${card.from}`, card.project && `проект «${card.project}»`, card.extra, age].filter(Boolean).join(" · ");
              return (
                <article key={entry.key} data-inbox={entry.kind} data-decision={entry.kind === "approval" ? "approve" : entry.kind} aria-current={selected?.key === entry.key ? "true" : undefined}
                  className={`rounded-xl border border-kumo-line p-4 ${selected?.key === entry.key ? "bg-kumo-tint" : "bg-kumo-base"}`}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-kumo-line bg-kumo-elevated text-kumo-subtle">{KIND[entry.kind].icon}</span>
                    <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => setSelectedKey(entry.key)}>
                      <RowText title={card.title} note={meta} />
                    </button>
                    <StatusBadge tone={KIND[entry.kind].tone}>{KIND[entry.kind].badge}</StatusBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-11">
                    {primary(entry)}
                    {card.chat && <Button variant="ghost" size="sm" onClick={() => chat(card.chat!, card.chatProject)}>Открыть в беседе</Button>}
                  </div>
                </article>
              );
            })}</div>}
          {filter === "approvals" && finished.length > 0 && <details className="mt-4">
            <summary className="cursor-pointer py-1 text-[13px] text-kumo-subtle">Уже решённые, устаревшие и отозванные · {finished.length}</summary>
            <div className="mt-2"><RowList>{finished.map(item => <ApprovalRow key={`${item.review.candidate_id}/${item.domain.domain_id}`} item={item} data={data} busy={decision.busy} decide={(i, a) => void decision.decide(i, a)} />)}</RowList></div>
          </details>}
          {filter === "approvals" && data.reviewsCursor && <div className="mt-3"><Button variant="secondary" size="sm" disabled={data.reviewsLoading} onClick={() => void data.loadMoreReviews()}>Показать ещё</Button></div>}
        </section>
        {selected && <aside aria-label="Подробности" className="min-w-0 rounded-xl border border-kumo-line bg-kumo-base p-4 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1"><RowText title={describe(selected).title} note={[describe(selected).project && `проект «${describe(selected).project}»`, describe(selected).extra].filter(Boolean).join(" · ")} /></div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedKey("")}>Закрыть</Button>
          </div>
          <EntryDetails entry={selected} names={names} decision={decision} publishing={publishing} publish={publish} sharing={sharing} decideShare={decideShare}
            onOpenCollaborations={openCollaborations} reloadTemplates={async () => { setSelectedKey(""); await templates.reload(); }} reloadAlerts={alerts.reload} />
        </aside>}
      </div>

      {filter === "all" && <>
        <Block title="Поручено мне" count={assigned.length} empty={data.collaborationsError || "Поручений вам нет."}>
          <RowList>{assigned.map(item => <CollaborationRow key={item.request.request_id} item={item} data={data} onOpen={openCollaborations} />)}</RowList>
        </Block>
        <Block title="Жду решения других" count={blocked.length + waitingCollaborations.length + (budgetBlocked ? 1 : 0) + waitingShares.length} empty="Чужих решений вы не ждёте.">
          <RowList>
            {waitingShares.map(share => (
              <Row key={share.request_id} className="items-start" data-share-request="">
                <RowText title={`Проект «${share.project_name}»: ждёт подтверждения ${shareDecider(share)}`} note={`вы попросили открыть его ${shareAudience(share)}`} />
                <StatusBadge tone="info">Ждёт подтверждения</StatusBadge>
              </Row>
            ))}
            {blocked.map(({ review, waitingFor, domains }) => (
              <Row key={review.candidate_id} className="items-start">
                <RowText title={`«${docs(review)}» ждёт согласования по направлению ${domains.join(", ")}`} note={`проект «${projectName(data.projects, review.project_id)}» · решение за ${waitingFor.map(id => personName(id)).join(", ")}`} />
              </Row>
            ))}
            {waitingCollaborations.map(item => (
              <Row key={item.request.request_id} className="items-start">
                <RowText title={`Обращение «${item.request.title}» ждёт результата`} note={`проект «${projectName(data.projects, item.request.project_id)}» · результат за: ${actorName(data.connections, item.request.target_agent_id, item.request.target_user_id)}`} />
                <Button variant="secondary" size="sm" onClick={openCollaborations}>Открыть</Button>
              </Row>
            ))}
            {budgetBlocked && (
              <Row className="items-start">
                <RowText title="Задача агента ждёт согласования бюджета" note={`проект «${projectName(data.projects, budgetBlocked.team_budget!.project_id)}» · решение за владельцем бюджета проекта`} />
                <Button variant="secondary" size="sm" onClick={() => legacy.open({ kind: "agentTask" }, "Задача агенту")}>Открыть</Button>
              </Row>
            )}
          </RowList>
        </Block>
      </>}
    </LegacySwitch>
  );
}

function EntryDetails({ entry, names, decision, publishing, publish, sharing, decideShare, onOpenCollaborations, reloadTemplates, reloadAlerts }: {
  entry: InboxEntry; names: Map<string, string>; decision: ReturnType<typeof useReviewDecision>; publishing: string;
  publish(review: PublicationReview): Promise<void>; sharing: string; decideShare(share: ShareRequest, approve: boolean): Promise<void>;
  onOpenCollaborations(): void; reloadTemplates(): Promise<void>; reloadAlerts(): Promise<void>;
}) {
  switch (entry.kind) {
    case "approval": {
      const key = `${entry.review!.candidate_id}/${entry.domain!.domain_id}`;
      const item = { review: entry.review!, domain: entry.domain!, mine: null };
      return <div className="space-y-4">
        <ReviewDetails key={`${entry.review!.candidate_id}/${entry.review!.decision_version}`} review={entry.review!} names={names} />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={decision.busy === key} onClick={() => void decision.decide(item, false)}>Отклонить</Button>
          <Button variant="primary" size="sm" disabled={decision.busy === key} onClick={() => void decision.decide(item, true)}>Одобрить</Button>
        </div>
      </div>;
    }
    case "publish":
      return <div className="space-y-3 text-[13px]">
        <p className="m-0 text-kumo-subtle">Все назначенные согласующие одобрили изменения. Публикация переносит их в общую версию проекта.</p>
        <Button variant="primary" size="sm" disabled={publishing === entry.review!.candidate_id} onClick={() => void publish(entry.review!)}>Опубликовать</Button>
      </div>;
    case "acceptance": {
      const r = entry.collaboration!.request;
      return <div className="space-y-3 text-[13px]">
        {r.description && <p className="m-0 whitespace-pre-wrap">{r.description}</p>}
        {r.criteria && <p className="m-0 text-kumo-subtle">Критерии приёмки: {r.criteria}</p>}
        <p className="m-0 text-kumo-subtle">Проверьте результат и примите его или верните на доработку в обращении.</p>
        <Button variant="primary" size="sm" onClick={onOpenCollaborations}>Открыть обращение</Button>
      </div>;
    }
    case "template":
      return <TemplateProposal key={entry.key} item={entry.template!.review} scope={entry.template!.scope} onDone={() => void reloadTemplates()} />;
    case "intake":
      return <div className="space-y-3 text-[13px]">
        {entry.alert!.alert.detail && <p className="m-0 text-kumo-subtle">{entry.alert!.alert.detail}</p>}
        <ProjectIntake projectId={entry.alert!.project} onPlaced={reloadAlerts} />
      </div>;
    case "share": {
      const s = entry.share!;
      return <div className="space-y-3 text-[13px]">
        <p className="m-0">После разрешения проект «{s.project_name}» увидят {s.level === "organization" ? "все сотрудники организации" : s.org_unit_name ? `сотрудники отдела «${s.org_unit_name}»` : "сотрудники отдела"}. {s.can_edit ? "Они смогут читать и править материалы." : "Они смогут только читать материалы."}</p>
        <p className="m-0 text-kumo-subtle">Отказ оставляет проект с прежним доступом; автор увидит ваше решение.</p>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" disabled={!!sharing} onClick={() => void decideShare(s, true)}>Разрешить</Button>
          <Button variant="secondary" size="sm" disabled={!!sharing} onClick={() => void decideShare(s, false)}>Отклонить</Button>
        </div>
      </div>;
    }
  }
}

function CollaborationRow({ item, data, onOpen }: { item: CollaborationItem; data: MemoryData; onOpen: () => void }) {
  const state = item.progress ? COLLABORATION_STATES[item.progress.state] : "Состояние недоступно";
  return (
    <Row className="items-start" data-collaboration="">
      <RowText title={item.request.title} note={`проект «${projectName(data.projects, item.request.project_id)}» · от: ${actorName(data.connections, item.request.requester_agent_id, item.request.requester_user_id)} · срок не задан`} />
      <StatusBadge tone={item.progress?.state === "accepted" ? "success" : item.progress?.state === "changes_requested" ? "danger" : "neutral"}>{state}</StatusBadge>
      <Button variant="secondary" size="sm" onClick={onOpen}>Открыть</Button>
    </Row>
  );
}
