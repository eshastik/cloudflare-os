import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Code, FileText, LockOpen, PaperPlaneTilt, SquaresFour, Stamp, Tray } from "@phosphor-icons/react";
import type { PublicationReview, SharedDocument } from "../src/mnemos-api.ts";
import type { ShareRequest } from "../src/project-sharing.ts";
import { inboxEntries, type InboxAlert, type InboxEntry, type InboxKind } from "../src/inbox-count.ts";
import { useHost, useUi } from "./host.ts";
import { actorName, documentNames, myApprovals, personName, projectName, UNNAMED_DOCUMENT, useLoad, type CollaborationItem, type MemoryData } from "./data.ts";
import { ApprovalRow, useReviewDecision } from "./ApprovalsTab.tsx";
import ReviewDetails from "./ReviewDetails.tsx";
import ProjectIntake from "./ProjectIntake.tsx";
import { TemplateProposal, loadTemplateReviews } from "./TemplateApprovals.tsx";
import { relativeTime } from "./time.ts";
import { plural } from "./names.ts";
import { Block, Button, DecisionCard, EmptyState, Notice, PageHeader, Row, RowList, RowText, StatusBadge } from "./ui.tsx";
import AcceptanceReview from "./AcceptanceReview.tsx";
import AgentRequests from "./AgentRequests.tsx";
import { PrivateCodeApproval, privateCodeConsentNeeded } from "./ProjectSharing.tsx";
import { REPOSITORY_FAILURES } from "../src/git-repositories.ts";

const COLLABORATION_STATES = { awaiting_result: "В работе", awaiting_review: "Ждёт приёмки", accepted: "Принято", changes_requested: "На доработке" } as const;
/** Сколько проектов опрашивать на вопросы приёмной; столько же берёт счётчик в навигации. */
const ALERT_PROJECTS = 10;

const KIND: Record<InboxKind, { icon: ReactNode; tone: "neutral" | "warning" | "brand" }> = {
  approval: { icon: <Stamp size={20} />, tone: "warning" },
  publish: { icon: <PaperPlaneTilt size={20} />, tone: "brand" },
  template: { icon: <SquaresFour size={20} />, tone: "warning" },
  acceptance: { icon: <Code size={20} />, tone: "brand" },
  intake: { icon: <Tray size={20} />, tone: "neutral" },
  share: { icon: <LockOpen size={20} />, tone: "neutral" },
  document: { icon: <FileText size={20} />, tone: "brand" },
};

/** «Николай Деревцов поделился с вами документом «План» — можно править». */
export function sharedDocumentTitle(d: Pick<SharedDocument, "granted_by_name" | "owner_name" | "name" | "mode">): string {
  return `${d.granted_by_name || d.owner_name || "Коллега"} поделился с вами документом «${d.name}» — ${d.mode === "write" ? "можно править" : "можно читать"}`;
}

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

/** «Входящие»: один плоский список того, что ждёт решения человека, новое сверху. У каждой карточки —
 * кто и что, кнопки решения на месте; подробности раскрываются внутри карточки. Ниже — недавно решённое. */
export default function MyWorkTab({ data }: { data: MemoryData }) {
  const ui = useUi();
  const host = useHost();
  const decision = useReviewDecision(data);
  const [selectedKey, setSelectedKey] = useState("");
  const [agentRequests, setAgentRequests] = useState(0);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [publishing, setPublishing] = useState("");
  const [sharing, setSharing] = useState("");
  // Запрос, одобрение которого ждёт подтверждения про приватный код проекта.
  const [privateCode, setPrivateCode] = useState<ShareRequest | null>(null);
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
  const sharedDocuments = useLoad(async () => await ui.listSharedDocuments().catch(() => [] as SharedDocument[]), "", [ui]);
  const myShares = useLoad(async () => (await ui.listShareRequests(true).catch(() => ({ requests: [] as ShareRequest[] }))).requests.filter(r => r.status === "pending"), "", [ui]);

  const entries = inboxEntries({ reviews: data.reviews, collaborations: data.collaborations, templates: templates.value ?? [], alerts: alerts.value ?? [], shares: shares.value ?? [], documents: sharedDocuments.value ?? [] }, userId);
  const selected = entries.find(entry => entry.key === selectedKey) ?? null;

  const assigned = data.collaborations.filter(item => item.request.target_user_id === userId && !item.request.target_agent_id && item.request.requester_user_id !== userId);
  const blocked = userId ? blockedReviews(data.reviews, userId) : [];
  const waitingCollaborations = data.collaborations.filter(item => item.request.requester_user_id === userId && item.progress?.state === "awaiting_result");
  const budgetBlocked = data.task && data.task.team_budget && !data.task.submitted ? data.task : null;
  const finished = userId ? myApprovals(data.reviews, userId).filter(item => item.mine !== null || item.review.stale || item.review.withdrawn) : [];
  const waitingShares = myShares.value ?? [];
  const waitingCount = blocked.length + waitingCollaborations.length + (budgetBlocked ? 1 : 0) + waitingShares.length;

  async function publish(review: PublicationReview) {
    setPublishing(review.candidate_id); setNotice(null);
    try {
      const state = await ui.draftState(review.project_id);
      if (state.personal_head !== review.personal_head || state.shared_head !== review.shared_head) throw new Error("changed");
      const result = await ui.publishDraft(review.project_id, state.personal_head, state.shared_head, "Publish reviewed changes");
      setNotice(result.refused ? { tone: "danger", text: result.refused } : result.published
        ? { tone: "success", text: "Изменения проекта опубликованы." }
        : result.conflicted ? { tone: "danger", text: "При публикации обнаружен конфликт. Откройте черновик и разрешите его." } : { tone: "danger", text: "Публикация не выполнена. Проверьте состояние черновика." });
      await data.reloadReviews();
    } catch {
      setNotice({ tone: "danger", text: "Публикация не подтверждена: версия черновика или права могли измениться. Откройте документ и проверьте состояние." });
    } finally {
      setPublishing("");
    }
  }
  async function decideShare(share: ShareRequest, approve: boolean, consent = false) {
    if (sharing) return;
    setSharing(share.request_id); setNotice(null);
    try {
      await ui.decideShareRequest(share.request_id, approve, consent);
      setPrivateCode(null);
      setNotice({ tone: "success", text: approve ? `Проект «${share.project_name}» открыт ${shareAudience(share)}.` : `Запрос отклонён: проект «${share.project_name}» остаётся с прежним доступом.` });
      setSelectedKey("");
      await shares.reload();
      if (approve) await data.reloadProjects();
    } catch (e) {
      if (approve && !consent && privateCodeConsentNeeded(e)) setPrivateCode(share);
      else setNotice({ tone: "danger", text: e instanceof Error && e.message === REPOSITORY_FAILURES["project.private_code_admin"] ? "В проекте код приватного репозитория: всей организации его открывает только администратор." : "Решение не записано: запрос мог быть уже решён или у вас нет права решать его. Обновите список." });
    } finally { setSharing(""); }
  }
  /** Открыть документ, которым поделились, в его редакторе. Документ лежит в ветке владельца, поэтому
   * открытие идёт с владельцем; уведомление отмечает прочитанным оболочка до перехода в редактор —
   * после перехода эта страница закрывается и её продолжение не выполняется. Здесь остаётся только отказ. */
  async function openShared(document: SharedDocument) {
    setNotice(null);
    try {
      if (!await host.openSharedDocument(document.project_id, document.owner_id, document.node_id))
        setNotice({ tone: "danger", text: `Документ «${document.name}» не открылся: у вас сейчас нет доступа к нему или к папке, где он лежит. Попросите владельца документа открыть доступ заново.` });
    } catch (error) {
      const reason = error instanceof Error && /[А-Яа-яЁё]/.test(error.message) ? error.message.replace(/\.$/, "") : "не удалось связаться с Mnemos";
      setNotice({ tone: "danger", text: `Документ «${document.name}» не открылся: ${reason}. Повторите попытку.` });
    }
    await sharedDocuments.reload().catch(() => {});
  }
  // Ссылка из письма открывает документ один раз, когда список общих документов прочитан.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !sharedDocuments.value) return;
    linked.current = true;
    void Promise.all([host.getSelectedProject().catch(() => ""), host.getSelectedDocument().catch(() => "")]).then(([project, node]) => {
      const document = node ? sharedDocuments.value?.find(d => d.node_id === node && (!project || d.project_id === project)) : undefined;
      if (document) void openShared(document);
    });
  }, [sharedDocuments.value]);
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
        return { title: `«${docs(r)}» можно публиковать`, from: "все согласующие одобрили", project: projectName(data.projects, r.project_id), extra: "" };
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
        return { title: `Куда положить «${file}»?`, from: "", project: projectName(data.projects, entry.alert!.project), extra: a.suggested_domain ? `предложена область «${a.suggested_domain}»` : "",
          chat: `Помоги решить, куда положить файл «${file}».`, chatProject: entry.alert!.project };
      }
      case "document": {
        const d = entry.document!;
        return { title: sharedDocumentTitle(d), from: "", project: d.project_name, extra: "" };
      }
      case "share": {
        const s = entry.share!;
        return { title: `${s.requested_by_name || personName(s.requested_by)} хочет открыть проект «${s.project_name}» ${shareAudience(s)}`, from: "", project: "",
          extra: s.can_edit ? "видящие смогут править" : "видящие смогут только читать" };
      }
    }
  }
  function actions(entry: InboxEntry): ReactNode {
    switch (entry.kind) {
      case "approval": {
        const key = `${entry.review!.candidate_id}/${entry.domain!.domain_id}`;
        return <Button disabled={decision.busy === key} onClick={() => void decision.decide({ review: entry.review!, domain: entry.domain!, mine: null }, true)}>Согласовать</Button>;
      }
      case "publish": return <Button disabled={publishing === entry.review!.candidate_id} onClick={() => void publish(entry.review!)}>Опубликовать</Button>;
      case "acceptance": return <Button onClick={() => setSelectedKey(entry.key)}>Проверить результат</Button>;
      case "template": return <Button onClick={() => setSelectedKey(entry.key)}>Рассмотреть</Button>;
      case "intake": return <Button onClick={() => setSelectedKey(entry.key)}>Решить</Button>;
      case "document": return <Button onClick={() => void openShared(entry.document!)}>Открыть</Button>;
      case "share": return <>
        <Button disabled={!!sharing} onClick={() => void decideShare(entry.share!, true)}>Разрешить</Button>
        <Button variant="secondary" disabled={!!sharing} onClick={() => void decideShare(entry.share!, false)}>Отклонить</Button>
      </>;
    }
  }

  const errors = [data.reviewsError, data.collaborationsError, templates.error, alerts.error].filter(Boolean);
  const loading = data.reviewsLoading || templates.loading || alerts.loading || shares.loading || sharedDocuments.loading;
  const total = entries.length + agentRequests;
  const subtitle = total > 0
    ? `${total} ${plural(total, "вещь", "вещи", "вещей")} ${plural(total, "ждёт", "ждут", "ждут")} вашего решения.`
    : loading ? "Проверяем, что ждёт вашего решения…" : "Сейчас ничего не ждёт вашего решения.";

  return (
    <div>
      <PageHeader title="Входящие" subtitle={subtitle} />

      {decision.notice && <div className="mb-3"><Notice tone={decision.notice.tone}>{decision.notice.text}</Notice></div>}
      {notice && <div className="mb-3"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      {privateCode && <div className="mb-3"><PrivateCodeApproval share={privateCode} busy={!!sharing} onConfirm={() => void decideShare(privateCode, true, true)} onCancel={() => setPrivateCode(null)} /></div>}
      {errors.map(error => <div key={error} className="mb-3"><Notice tone="danger">{error}</Notice></div>)}

      <section aria-label="Ждут вашего решения" className="mb-10 flex flex-col gap-4">
        {entries.map(entry => {
          const card = describe(entry);
          const age = relativeTime(entry.at);
          const note = [card.from && `От: ${card.from}`, card.project && `проект «${card.project}»`, card.extra, age].filter(Boolean).join(" · ");
          const open = selected?.key === entry.key;
          return (
            <DecisionCard key={entry.key} data-inbox={entry.kind} data-decision={entry.kind === "approval" ? "approve" : entry.kind} aria-current={open ? "true" : undefined}
              icon={KIND[entry.kind].icon} tone={KIND[entry.kind].tone} title={card.title} note={note}
              onToggle={() => setSelectedKey(open ? "" : entry.key)} expanded={open}
              actions={<>
                {actions(entry)}
                {card.chat && <Button variant="secondary" onClick={() => chat(card.chat!, card.chatProject)}>Открыть в беседе</Button>}
              </>}>
              {open && <aside aria-label="Подробности" className="rounded-[14px] bg-kumo-base p-4 sm:ml-[54px]">
                <EntryDetails entry={entry} names={names} decision={decision} publishing={publishing} publish={publish} sharing={sharing} decideShare={decideShare}
                  reloadCollaborations={data.reloadCollaborations} reloadTemplates={async () => { setSelectedKey(""); await templates.reload(); }} reloadAlerts={alerts.reload} />
                <div className="mt-3"><Button variant="ghost" size="sm" onClick={() => setSelectedKey("")}>Закрыть</Button></div>
              </aside>}
            </DecisionCard>
          );
        })}
        <AgentRequests data={data} onCount={setAgentRequests} />
        {total === 0 && !loading && <EmptyState title="Всё решено" description="Сейчас ничего не ждёт вашего решения. Здесь появятся согласования, результаты работы агентов, запросы доступа к проектам и вопросы по загруженным материалам." />}
        {total === 0 && loading && <Notice>Загрузка…</Notice>}
        {data.reviewsCursor && <div><Button variant="secondary" disabled={data.reviewsLoading} onClick={() => void data.loadMoreReviews()}>Показать ещё</Button></div>}
      </section>

      {(assigned.length > 0 || data.collaborationsError) && <Block title="Поручено мне" count={assigned.length} empty={data.collaborationsError || "Поручений вам нет."}>
        <RowList>{assigned.map(item => <CollaborationRow key={item.request.request_id} item={item} data={data} onChat={() => chat(`Помоги выполнить поручение «${item.request.title}»: что нужно сделать и по каким критериям?`, item.request.project_id)} />)}</RowList>
      </Block>}

      {waitingCount > 0 && <Block title="Жду решения других" count={waitingCount}>
        <RowList>
          {waitingShares.map(share => (
            <Row key={share.request_id} className="items-start" data-share-request="">
              <RowText title={`Проект «${share.project_name}»: ждёт подтверждения ${shareDecider(share)}`} note={`вы попросили открыть его ${shareAudience(share)}`} />
            </Row>
          ))}
          {blocked.map(({ review, waitingFor, domains }) => (
            <Row key={review.candidate_id} className="items-start">
              <RowText title={`«${docs(review)}» ждёт согласования`} note={`проект «${projectName(data.projects, review.project_id)}» · направление ${domains.join(", ")} · решение за ${waitingFor.map(id => personName(id)).join(", ")}`} />
            </Row>
          ))}
          {waitingCollaborations.map(item => (
            <Row key={item.request.request_id} className="items-start">
              <RowText title={`Поручение «${item.request.title}» ждёт результата`} note={`проект «${projectName(data.projects, item.request.project_id)}» · результат за: ${actorName(data.connections, item.request.target_agent_id, item.request.target_user_id)}`} />
            </Row>
          ))}
          {budgetBlocked && (
            <Row className="items-start">
              <RowText title="Задача агента ждёт согласования бюджета" note={`проект «${projectName(data.projects, budgetBlocked.team_budget!.project_id)}» · решение за владельцем бюджета проекта`} />
            </Row>
          )}
        </RowList>
      </Block>}

      {finished.length > 0 && <Block title="Недавно решено" count={finished.length}>
        <RowList>{finished.map(item => <ApprovalRow key={`${item.review.candidate_id}/${item.domain.domain_id}`} item={item} data={data} busy={decision.busy} decide={(i, a) => void decision.decide(i, a)} />)}</RowList>
      </Block>}
    </div>
  );
}

function EntryDetails({ entry, names, decision, publishing, publish, sharing, decideShare, reloadCollaborations, reloadTemplates, reloadAlerts }: {
  entry: InboxEntry; names: Map<string, string>; decision: ReturnType<typeof useReviewDecision>; publishing: string;
  publish(review: PublicationReview): Promise<void>; sharing: string; decideShare(share: ShareRequest, approve: boolean): Promise<void>;
  reloadCollaborations(): Promise<void>; reloadTemplates(): Promise<void>; reloadAlerts(): Promise<void>;
}) {
  switch (entry.kind) {
    case "approval": {
      const key = `${entry.review!.candidate_id}/${entry.domain!.domain_id}`;
      const item = { review: entry.review!, domain: entry.domain!, mine: null };
      return <div className="space-y-4">
        <ReviewDetails key={`${entry.review!.candidate_id}/${entry.review!.decision_version}`} review={entry.review!} names={names} />
        <div className="flex gap-2">
          <Button size="sm" disabled={decision.busy === key} onClick={() => void decision.decide(item, true)}>Согласовать</Button>
          <Button variant="secondary" size="sm" disabled={decision.busy === key} onClick={() => void decision.decide(item, false)}>Отклонить</Button>
        </div>
      </div>;
    }
    case "publish":
      return <div className="space-y-3 text-[14px]">
        <p className="m-0 text-kumo-subtle">Все назначенные согласующие одобрили изменения. Публикация переносит их в общую версию проекта.</p>
        <Button size="sm" disabled={publishing === entry.review!.candidate_id} onClick={() => void publish(entry.review!)}>Опубликовать</Button>
      </div>;
    case "acceptance":
      return <AcceptanceReview key={entry.key} item={entry.collaboration!} onDone={reloadCollaborations} />;
    case "template":
      return <TemplateProposal key={entry.key} item={entry.template!.review} scope={entry.template!.scope} onDone={() => void reloadTemplates()} />;
    case "intake":
      return <div className="space-y-3 text-[14px]">
        {entry.alert!.alert.detail && <p className="m-0 text-kumo-subtle">{entry.alert!.alert.detail}</p>}
        <ProjectIntake projectId={entry.alert!.project} onPlaced={reloadAlerts} />
      </div>;
    case "document": {
      const d = entry.document!;
      return <p className="m-0 text-[14px] text-kumo-subtle">{d.mode === "write" ? "Вы правите тот же документ, что и автор: правки сохраняются в его документ, и оба видят их после обновления." : "Документ открыт только для чтения."} Проект «{d.project_name}».</p>;
    }
    case "share": {
      const s = entry.share!;
      return <div className="space-y-3 text-[14px]">
        <p className="m-0">После разрешения проект «{s.project_name}» увидят {s.level === "organization" ? "все сотрудники организации" : s.org_unit_name ? `сотрудники отдела «${s.org_unit_name}»` : "сотрудники отдела"}. {s.can_edit ? "Они смогут читать и править материалы." : "Они смогут только читать материалы."}</p>
        <p className="m-0 text-kumo-subtle">Отказ оставляет проект с прежним доступом; автор увидит ваше решение.</p>
      </div>;
    }
  }
}

function CollaborationRow({ item, data, onChat }: { item: CollaborationItem; data: MemoryData; onChat: () => void }) {
  const state = item.progress ? COLLABORATION_STATES[item.progress.state] : "Состояние недоступно";
  return (
    <Row className="items-start" data-collaboration="">
      <RowText title={item.request.title} note={`проект «${projectName(data.projects, item.request.project_id)}» · от: ${actorName(data.connections, item.request.requester_agent_id, item.request.requester_user_id)} · срок не задан`} />
      <StatusBadge tone={item.progress?.state === "accepted" ? "success" : item.progress?.state === "changes_requested" ? "danger" : "neutral"}>{state}</StatusBadge>
      <Button variant="secondary" size="sm" onClick={onChat}>Открыть в беседе</Button>
    </Row>
  );
}
