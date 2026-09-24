import { useEffect, useState, type ReactNode } from "react";
import { CalendarBlank, EnvelopeSimple, Wallet } from "@phosphor-icons/react";
import type { TeamBudgetProposal } from "../src/mnemos-api.ts";
import type { MailDraftReview } from "../src/mail-drafts.ts";
import type { CalendarDraftReview } from "../src/calendar-drafts.ts";
import { formatBudgetUSD } from "../app/budget-money.ts";
import { useHost, useUi } from "./host.ts";
import { agentName, projectName, useLoad, type MemoryData } from "./data.ts";
import { Button, DecisionCard, Notice, textAreaClass } from "./ui.tsx";

/** Сколько проектов опрашивать на заявки бюджета. */
const BUDGET_PROJECTS = 10;

type Request =
  | { kind: "budget"; key: string; project: string; proposal: TeamBudgetProposal; policyRevision: number }
  | { kind: "mail"; key: string; draft: MailDraftReview; provider: string }
  | { kind: "meeting"; key: string; draft: CalendarDraftReview; provider: string };

const SEND_PROVIDERS = ["google", "microsoft", "apple", "yandex", "imap"];
const MEETING_PROVIDERS = ["google", "microsoft", "apple", "yandex", "caldav"];

/** Просьбы агентов к человеку во «Входящих»: письма, встречи и расходы — карточками в общем списке.
 * Кнопки решения на карточке, текст письма или задачи раскрывается на месте. Решение записывается
 * ровно по показанной версии. Число карточек сообщается «Входящим» для подзаголовка. */
export default function AgentRequests({ data, onCount }: { data: MemoryData; onCount?(count: number): void }) {
  const ui = useUi();
  const userId = data.identity?.subject.user_id ?? "";
  const projectIds = data.projects.slice(0, BUDGET_PROJECTS).map(p => p.id).join(",");
  const requests = useLoad(async (): Promise<Request[]> => {
    const out: Request[] = [];
    const [mail, calendars] = await Promise.all([ui.listMailConnections("").catch(() => ({ connections: [] })), ui.listCalendarConnections("").catch(() => ({ connections: [] }))]);
    for (const c of mail.connections.filter(c => c.enabled)) {
      const page = await ui.listMailDrafts(c.connection_id, "").catch(() => ({ drafts: [] }));
      for (const d of page.drafts.filter(d => d.state === "pending" || d.state === "approved")) {
        const draft = await ui.readMailDraft(d.id).catch(() => null);
        if (draft && !draft.delivery) out.push({ kind: "mail", key: `mail/${d.id}`, draft, provider: c.provider });
      }
    }
    for (const c of calendars.connections.filter(c => c.enabled)) {
      const page = await ui.listCalendarDrafts(c.connection_id, "").catch(() => ({ drafts: [] }));
      for (const d of page.drafts.filter(d => d.state === "pending" || d.state === "approved")) {
        const draft = await ui.readCalendarDraft(d.id).catch(() => null);
        if (draft && !draft.execution) out.push({ kind: "meeting", key: `meeting/${d.id}`, draft, provider: c.provider });
      }
    }
    for (const project of projectIds ? projectIds.split(",") : []) {
      const policy = await ui.readProjectBudget(project).catch(() => null);
      if (!policy || policy.owner_id !== userId) continue;
      const page = await ui.listTeamBudgets(project, "").catch(() => ({ proposals: [] }));
      for (const p of page.proposals.filter(p => p.state === "awaiting_approval")) {
        const proposal = await ui.readTeamBudget(project, p.id).catch(() => null);
        if (proposal) out.push({ kind: "budget", key: `budget/${p.id}`, project, proposal, policyRevision: policy.revision });
      }
    }
    return out;
  }, "Просьбы агентов не прочитаны. Обновите страницу.", [ui, userId, projectIds]);
  const list = requests.value ?? [];
  useEffect(() => { onCount?.(list.length); }, [onCount, list.length]);
  return <>
    {requests.error && <Notice tone="danger">{requests.error}</Notice>}
    {list.map(r => <RequestCard key={r.key} request={r} data={data} onDone={requests.reload} />)}
  </>;
}

function RequestCard({ request, data, onDone }: { request: Request; data: MemoryData; onDone(): Promise<void> }) {
  const ui = useUi();
  const host = useHost();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const agent = agentName(data.connections, request.kind === "budget" ? request.proposal.agent_id : request.draft.agent_id);

  async function act(work: () => Promise<unknown>, done: string, failure: string) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await work(); setNotice({ tone: "success", text: done }); await onDone(); }
    catch { setNotice({ tone: "danger", text: failure }); }
    finally { setBusy(false); }
  }

  let title = "", note = "", primary: ReactNode = null, reject: (() => void) | null = null, details: ReactNode = null;
  if (request.kind === "mail") {
    const d = request.draft;
    title = `Письмо «${d.content.subject || "без темы"}» для ${d.content.to.join(", ")}`;
    note = `${agent} подготовил письмо`;
    const canSend = SEND_PROVIDERS.includes(request.provider);
    primary = d.state === "approved"
      ? <Button disabled={busy || !canSend} onClick={() => void act(() => host.sendMailDraft(d.id, d.sha256), "Письмо отправлено.", "Отправка не подтверждена. Проверьте почту, прежде чем отправлять снова.")}>Отправить</Button>
      : <Button disabled={busy} onClick={() => void act(async () => { await ui.decideMailDraft(d.id, d.sha256, true); if (canSend) await host.sendMailDraft(d.id, d.sha256); }, canSend ? "Письмо согласовано и отправлено." : "Письмо согласовано.", "Не получилось. Обновите страницу и проверьте письмо ещё раз.")}>{canSend ? "Согласовать и отправить" : "Согласовать"}</Button>;
    if (d.state === "pending") reject = () => void act(() => ui.decideMailDraft(d.id, d.sha256, false), "Письмо отклонено.", "Решение не записано. Обновите страницу.");
    details = <>
      <p className="m-0">Кому: {d.content.to.join(", ")}{d.content.cc?.length ? ` · копия: ${d.content.cc.join(", ")}` : ""}</p>
      <pre className="m-0 whitespace-pre-wrap rounded-[12px] bg-kumo-base p-3 font-sans">{d.content.body}</pre>
      {!!d.content.attachments?.length && <p className="m-0 text-kumo-subtle">Вложения: {d.content.attachments.map(a => a.filename).join(", ")}</p>}
    </>;
  } else if (request.kind === "meeting") {
    const d = request.draft;
    const when = new Date(d.content.start).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    title = `Встреча «${d.content.title}» — ${when}`;
    note = `${agent} предлагает встречу${d.content.attendees.length ? ` с ${d.content.attendees.join(", ")}` : ""}`;
    const canCreate = MEETING_PROVIDERS.includes(request.provider);
    primary = d.state === "approved"
      ? <Button disabled={busy || !canCreate} onClick={() => void act(() => host.createCalendarDraft(d.id, d.sha256), "Встреча создана в календаре.", "Создание не подтверждено. Проверьте календарь, прежде чем повторять.")}>Создать встречу</Button>
      : <Button disabled={busy} onClick={() => void act(async () => { await ui.decideCalendarDraft(d.id, d.sha256, true); if (canCreate) await host.createCalendarDraft(d.id, d.sha256); }, canCreate ? "Встреча согласована и создана." : "Встреча согласована.", "Не получилось. Обновите страницу и проверьте встречу ещё раз.")}>{canCreate ? "Согласовать и создать" : "Согласовать"}</Button>;
    if (d.state === "pending") reject = () => void act(() => ui.decideCalendarDraft(d.id, d.sha256, false), "Встреча отклонена.", "Решение не записано. Обновите страницу.");
    details = <>
      <p className="m-0">С {when} до {new Date(d.content.end).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" })}{d.content.location ? ` · ${d.content.location}` : ""}</p>
      {d.content.description && <pre className="m-0 whitespace-pre-wrap rounded-[12px] bg-kumo-base p-3 font-sans">{d.content.description}</pre>}
    </>;
  } else {
    const p = request.proposal;
    title = `Расход до ${formatBudgetUSD(p.proposal.limit_usd_micros)} $ на задачу «${p.proposal.task.slice(0, 80)}»`;
    note = `проект «${projectName(data.projects, request.project)}» · оценка ${formatBudgetUSD(p.proposal.estimate_usd_micros)} $ · агентов: ${p.proposal.members.length}`;
    const decide = (decision: "approved" | "rejected") => ui.decideTeamBudget(request.project, p.id, { decision_id: crypto.randomUUID(), expected_revision: p.decision?.revision ?? 0, policy_revision: request.policyRevision, decision, comment: comment.trim() || (decision === "approved" ? "Разрешено." : "Отклонено.") });
    primary = <Button disabled={busy} onClick={() => void act(() => decide("approved"), "Расход разрешён.", "Решение не записано: заявка или правила бюджета могли измениться.")}>Разрешить</Button>;
    reject = () => void act(() => decide("rejected"), "Расход отклонён.", "Решение не записано. Обновите страницу.");
    details = <>
      <pre className="m-0 whitespace-pre-wrap rounded-[12px] bg-kumo-base p-3 font-sans">{p.proposal.task}</pre>
      {p.proposal.criteria && <p className="m-0 text-kumo-subtle">Что должно получиться: {p.proposal.criteria}</p>}
    </>;
  }

  const icon = request.kind === "mail" ? <EnvelopeSimple size={20} /> : request.kind === "meeting" ? <CalendarBlank size={20} /> : <Wallet size={20} />;
  return <DecisionCard data-agent-request={request.kind} icon={icon} tone="warning" title={title} note={note} onToggle={() => setOpen(!open)} expanded={open}
    actions={<>
      {primary}
      {reject && <Button variant="secondary" disabled={busy} onClick={reject}>Отклонить</Button>}
      <Button variant="ghost" onClick={() => setOpen(!open)}>{open ? "Свернуть" : "Подробнее"}</Button>
    </>}>
    {open && <div className="grid gap-2 text-[14px] sm:ml-[54px]">
      {details}
      {request.kind === "budget" && <label className="grid gap-1">Комментарий к решению<textarea aria-label="Комментарий к решению" rows={2} value={comment} disabled={busy} onChange={e => setComment(e.target.value)} className={textAreaClass} /></label>}
    </div>}
    {notice && <div className="sm:ml-[54px]"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
  </DecisionCard>;
}
