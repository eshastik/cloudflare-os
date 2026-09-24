import type { CollaborationProgress, CollaborationRequest, PublicationReview } from "./mnemos-api.ts";
import type { TemplatePromotionReview, TemplateScope } from "./work-templates.ts";
import type { IntakeAlert } from "./intake.ts";
import type { ShareRequest } from "./project-sharing.ts";

/** Обращение с его текущим состоянием; состояние может быть не прочитано. */
export interface InboxCollaboration { request: CollaborationRequest; progress: CollaborationProgress | null }
/** Предложение шаблона вместе с областью, в которой его согласуют. */
export interface InboxTemplate { scope: TemplateScope; review: TemplatePromotionReview }
/** Вопрос приёмной вместе с проектом, в приёмную которого загружен файл. */
export interface InboxAlert { project: string; alert: IntakeAlert }

export type InboxKind = "approval" | "publish" | "template" | "acceptance" | "intake" | "share";
export type InboxFilter = "approvals" | "agents" | "intake" | "access";
/** Фильтр «Входящих», к которому относится каждый вид решения. */
export const INBOX_FILTER: Record<InboxKind, InboxFilter> = { approval: "approvals", publish: "approvals", template: "approvals", acceptance: "agents", intake: "intake", share: "access" };

export interface InboxEntry {
  key: string;
  kind: InboxKind;
  /** Момент появления, если источник его сообщает; у предложений публикации его нет. */
  at: string;
  review?: PublicationReview;
  domain?: PublicationReview["domains"][number];
  collaboration?: InboxCollaboration;
  template?: InboxTemplate;
  alert?: InboxAlert;
  share?: ShareRequest;
}

export interface InboxSources {
  reviews: PublicationReview[];
  collaborations: InboxCollaboration[];
  templates?: InboxTemplate[];
  alerts?: InboxAlert[];
  /** Запросы открыть проект отделу или организации, которые ждут решения этого человека. */
  shares?: ShareRequest[];
}

/** Всё, что ждёт решения человека. Один список для экрана и для счётчика в навигации,
 * чтобы число в меню и число строк не расходились. Новое сверху; элементы без времени
 * (предложения публикации) идут первыми в порядке сервера. */
export function inboxEntries(sources: InboxSources, userId: string): InboxEntry[] {
  if (!userId) return [];
  const out: InboxEntry[] = [];
  for (const review of sources.reviews) {
    if (review.stale || review.withdrawn) continue;
    for (const domain of review.domains) {
      if (domain.approvers.includes(userId) && !domain.decisions.some(d => d.approver_id === userId)) out.push({ key: `approval/${review.candidate_id}/${domain.domain_id}`, kind: "approval", at: "", review, domain });
    }
  }
  for (const review of sources.reviews) {
    if (review.author_id === userId && review.ready && !review.stale && !review.withdrawn) out.push({ key: `publish/${review.candidate_id}`, kind: "publish", at: "", review });
  }
  for (const item of sources.collaborations) {
    if (item.request.requester_user_id === userId && item.progress?.state === "awaiting_review") out.push({ key: `acceptance/${item.request.request_id}`, kind: "acceptance", at: item.request.created_at ?? "", collaboration: item });
  }
  for (const template of sources.templates ?? []) {
    if (!template.review.decision && template.review.proposal.user_id !== userId) out.push({ key: `template/${template.review.proposal.proposal_id}`, kind: "template", at: template.review.proposal.created_at ?? "", template });
  }
  const seen = new Set<string>();
  for (const item of sources.alerts ?? []) {
    if (item.alert.status !== "open" || seen.has(item.alert.id)) continue;
    seen.add(item.alert.id);
    out.push({ key: `intake/${item.alert.id}`, kind: "intake", at: item.alert.raised_at ?? "", alert: item });
  }
  const shared = new Set<string>();
  for (const share of sources.shares ?? []) {
    if (share.status !== "pending" || share.requested_by === userId || shared.has(share.request_id)) continue;
    shared.add(share.request_id);
    out.push({ key: `share/${share.request_id}`, kind: "share", at: share.created_at ?? "", share });
  }
  const time = (entry: InboxEntry) => { const t = Date.parse(entry.at); return Number.isFinite(t) ? t : Infinity; };
  return out.map((entry, index) => ({ entry, index })).sort((a, b) => time(b.entry) - time(a.entry) || a.index - b.index).map(x => x.entry);
}

/** Виды, которые решает согласующий или руководитель: чужая работа ждёт его решения. */
const APPROVAL_KINDS = new Set<InboxKind>(["approval", "template", "share"]);

/** Два счётчика меню из одного списка: всё во «Входящих» и решения по чужой работе. */
export function inboxCounts(reviews: PublicationReview[], collaborations: InboxCollaboration[], userId: string, extra: { templates?: InboxTemplate[]; alerts?: InboxAlert[]; shares?: ShareRequest[] } = {}): { inbox: number; approvals: number } {
  const entries = inboxEntries({ reviews, collaborations, ...extra }, userId);
  return { inbox: entries.length, approvals: entries.filter(entry => APPROVAL_KINDS.has(entry.kind)).length };
}

/** Число решений, которые ждут человека во «Входящих». */
export function inboxDecisions(reviews: PublicationReview[], collaborations: InboxCollaboration[], userId: string, extra: { templates?: InboxTemplate[]; alerts?: InboxAlert[]; shares?: ShareRequest[] } = {}): number {
  return inboxEntries({ reviews, collaborations, ...extra }, userId).length;
}
