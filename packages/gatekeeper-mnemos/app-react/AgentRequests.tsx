import { useState, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo";
import type { TeamBudgetProposal } from "../src/mnemos-api.ts";
import type { MailDraftReview } from "../src/mail-drafts.ts";
import type { CalendarDraftReview } from "../src/calendar-drafts.ts";
import { formatBudgetUSD } from "../app/budget-money.ts";
import { useHost, useUi } from "./host.ts";
import { agentName, projectName, useLoad, type MemoryData } from "./data.ts";
import { Block, Notice, StatusBadge } from "./ui.tsx";

/** Сколько проектов опрашивать на заявки бюджета. */
const BUDGET_PROJECTS = 10;

type Request =
  | { kind: "budget"; key: string; project: string; proposal: TeamBudgetProposal; policyRevision: number }
  | { kind: "mail"; key: string; draft: MailDraftReview; provider: string }
  | { kind: "meeting"; key: string; draft: CalendarDraftReview; provider: string };

const SEND_PROVIDERS = ["google", "microsoft", "apple", "yandex", "imap"];
const MEETING_PROVIDERS = ["google", "microsoft", "apple", "yandex", "caldav"];

/** Просьбы агентов к человеку во «Входящих»: письма, встречи и расходы. Карточка — одна главная кнопка,
 * подробности раскрываются на месте. Решение записывается ровно по показанной версии. */
export default function AgentRequests({ data }: { data: MemoryData }) {
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
  if (!requests.error && list.length === 0) return null;
  return <Block title="Просьбы агентов" count={list.length}>
    {requests.error && <Notice tone="danger">{requests.error}</Notice>}
    <div className="grid gap-3">{list.map(r => <RequestCard key={r.key} request={r} data={data} onDone={requests.reload} />)}</div>
  </Block>;
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
      ? <Button variant="primary" size="sm" disabled={busy || !canSend} onClick={() => void act(() => host.sendMailDraft(d.id, d.sha256), "Письмо отправлено.", "Отправка не подтверждена. Проверьте почту, прежде чем отправлять снова.")}>Отправить</Button>
      : <Button variant="primary" size="sm" disabled={busy} onClick={() => void act(async () => { await ui.decideMailDraft(d.id, d.sha256, true); if (canSend) await host.sendMailDraft(d.id, d.sha256); }, canSend ? "Письмо согласовано и отправлено." : "Письмо согласовано.", "Не получилось. Обновите страницу и проверьте письмо ещё раз.")}>{canSend ? "Согласовать и отправить" : "Согласовать"}</Button>;
    if (d.state === "pending") reject = () => void act(() => ui.decideMailDraft(d.id, d.sha256, false), "Письмо отклонено.", "Решение не записано. Обновите страницу.");
    details = <>
      <p className="m-0">Кому: {d.content.to.join(", ")}{d.content.cc?.length ? ` · копия: ${d.content.cc.join(", ")}` : ""}</p>
      <pre className="m-0 whitespace-pre-wrap rounded-lg border border-kumo-line bg-kumo-elevated p-3 font-sans">{d.content.body}</pre>
      {!!d.content.attachments?.length && <p className="m-0 text-kumo-subtle">Вложения: {d.content.attachments.map(a => a.filename).join(", ")}</p>}
    </>;
  } else if (request.kind === "meeting") {
    const d = request.draft;
    const when = new Date(d.content.start).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    title = `Встреча «${d.content.title}» — ${when}`;
    note = `${agent} предлагает встречу${d.content.attendees.length ? ` с ${d.content.attendees.join(", ")}` : ""}`;
    const canCreate = MEETING_PROVIDERS.includes(request.provider);
    primary = d.state === "approved"
      ? <Button variant="primary" size="sm" disabled={busy || !canCreate} onClick={() => void act(() => host.createCalendarDraft(d.id, d.sha256), "Встреча создана в календаре.", "Создание не подтверждено. Проверьте календарь, прежде чем повторять.")}>Создать встречу</Button>
      : <Button variant="primary" size="sm" disabled={busy} onClick={() => void act(async () => { await ui.decideCalendarDraft(d.id, d.sha256, true); if (canCreate) await host.createCalendarDraft(d.id, d.sha256); }, canCreate ? "Встреча согласована и создана." : "Встреча согласована.", "Не получилось. Обновите страницу и проверьте встречу ещё раз.")}>{canCreate ? "Согласовать и создать" : "Согласовать"}</Button>;
    if (d.state === "pending") reject = () => void act(() => ui.decideCalendarDraft(d.id, d.sha256, false), "Встреча отклонена.", "Решение не записано. Обновите страницу.");
    details = <>
      <p className="m-0">С {when} до {new Date(d.content.end).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" })}{d.content.location ? ` · ${d.content.location}` : ""}</p>
      {d.content.description && <pre className="m-0 whitespace-pre-wrap rounded-lg border border-kumo-line bg-kumo-elevated p-3 font-sans">{d.content.description}</pre>}
    </>;
  } else {
    const p = request.proposal;
    title = `Расход до ${formatBudgetUSD(p.proposal.limit_usd_micros)} $ на задачу «${p.proposal.task.slice(0, 80)}»`;
    note = `проект «${projectName(data.projects, request.project)}» · оценка ${formatBudgetUSD(p.proposal.estimate_usd_micros)} $ · агентов: ${p.proposal.members.length}`;
    const decide = (decision: "approved" | "rejected") => ui.decideTeamBudget(request.project, p.id, { decision_id: crypto.randomUUID(), expected_revision: p.decision?.revision ?? 0, policy_revision: request.policyRevision, decision, comment: comment.trim() || (decision === "approved" ? "Разрешено." : "Отклонено.") });
    primary = <Button variant="primary" size="sm" disabled={busy} onClick={() => void act(() => decide("approved"), "Расход разрешён.", "Решение не записано: заявка или правила бюджета могли измениться.")}>Разрешить</Button>;
    reject = () => void act(() => decide("rejected"), "Расход отклонён.", "Решение не записано. Обновите страницу.");
    details = <>
      <pre className="m-0 whitespace-pre-wrap rounded-lg border border-kumo-line bg-kumo-elevated p-3 font-sans">{p.proposal.task}</pre>
      {p.proposal.criteria && <p className="m-0 text-kumo-subtle">Что должно получиться: {p.proposal.criteria}</p>}
    </>;
  }

  return <article data-agent-request={request.kind} className="rounded-xl border border-kumo-line bg-kumo-base p-4 text-[13px]">
    <div className="flex items-start gap-3">
      <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="font-medium text-kumo-default">{title}</div>
        <div className="mt-0.5 text-[12px] text-kumo-subtle">{note}</div>
      </button>
      <StatusBadge tone="warning">{request.kind === "mail" ? "Письмо" : request.kind === "meeting" ? "Встреча" : "Расход"}</StatusBadge>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {primary}
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>{open ? "Свернуть" : "Подробнее"}</Button>
    </div>
    {open && <div className="mt-3 grid gap-2">
      {details}
      {request.kind === "budget" && <label className="grid gap-1">Комментарий<textarea aria-label="Комментарий к решению" rows={2} value={comment} disabled={busy} onChange={e => setComment(e.target.value)} className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-base p-2 text-[13px]" /></label>}
      {reject && <div><Button variant="secondary" size="sm" disabled={busy} onClick={reject}>Отклонить</Button></div>}
    </div>}
    {notice && <div className="mt-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
  </article>;
}
