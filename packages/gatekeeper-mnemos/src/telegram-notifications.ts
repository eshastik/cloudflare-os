// Уведомления Mnemos для личного бота Telegram (ADR 0027, раздел 5). Всё здесь идёт сессией
// человека: бот оболочки зовёт эти операции от имени владельца бота, и решения по кнопкам
// принимает сам человек, а не агент.
//
// Решение кнопкой готовится при отправке уведомления (prepare): берётся версия объекта, которую
// человек видит в карточке. При нажатии (decide) версия сверяется заново: объект, изменившийся
// после отправки, кнопкой не решается — только на сайте.

import {
  NOTIFICATION_KINDS, validNotificationKinds, validNotificationObject, validNotificationPage,
  type NotificationDecisionResult, type NotificationDecisionTicket, type NotificationKind, type NotificationObject,
  type NotificationPage, type NotificationSettings,
} from "@gadgets/workshop-shared/telegram-bot";
import type { PublicationReview } from "@gadgets/workshop-shared/publication-review";
import { MnemosAPIError, type CollaborationProgress, type CollaborationReview, type CollaborationReviewCreate, type WhoAmI } from "./mnemos-api.ts";
import type { ShareRequest } from "./project-sharing.ts";

export const PLATFORM_METRICS_CAPABILITY = "platform.metrics.read";
const PRIVATE_CODE_CONSENT = "project.private_code_consent";

/** Операции сессии человека, которые нужны уведомлениям. */
export interface NotificationSession {
  whoAmI(): Promise<WhoAmI>;
  readNotifications(after: number | null, limit: number): Promise<unknown>;
  acknowledgeNotifications(sequence: number): Promise<{ delivered: number }>;
  readNotificationSettings(): Promise<{ kinds?: unknown }>;
  saveNotificationSettings(kinds: Record<string, boolean>): Promise<{ kinds?: unknown }>;
  readPublicationReview(id: string): Promise<PublicationReview>;
  recordReviewDecision(id: string, domain: string, version: number, approved: boolean): Promise<void>;
  listShareRequests(mine: boolean): Promise<{ requests: ShareRequest[] }>;
  decideShareRequest(request: string, approve: boolean): Promise<ShareRequest>;
  readCollaborationProgress(id: string): Promise<CollaborationProgress>;
  reviewCollaborationResult(id: string, review: CollaborationReviewCreate): Promise<CollaborationReview>;
}

export async function readNotificationPage(session: NotificationSession, after: number | null, limit: number): Promise<NotificationPage> {
  let page = validNotificationPage(await session.readNotifications(after, limit));
  if (!page) throw new MnemosAPIError(502);
  return page;
}

export async function acknowledgeNotificationPage(session: NotificationSession, sequence: number): Promise<number> {
  let out = await session.acknowledgeNotifications(sequence);
  if (!out || !Number.isSafeInteger(out.delivered) || out.delivered < 0) throw new MnemosAPIError(502);
  return out.delivered;
}

export async function readNotificationSettings(session: NotificationSession): Promise<NotificationSettings> {
  let [identity, raw] = await Promise.all([session.whoAmI(), session.readNotificationSettings()]);
  let kinds = validNotificationKinds(raw?.kinds);
  if (!kinds) throw new MnemosAPIError(502);
  return { kinds, platformFailure: identity.capabilities?.includes(PLATFORM_METRICS_CAPABILITY) === true };
}

/** Сохранить все четыре вида. «Сбои системы» у не-администратора не меняются: экран их не показывает. */
export async function saveNotificationSettings(session: NotificationSession, input: unknown): Promise<NotificationSettings> {
  let kinds = validNotificationKinds(input);
  if (!kinds) throw new MnemosAPIError(400);
  let current = await readNotificationSettings(session);
  let next: Record<NotificationKind, boolean> = { ...kinds };
  if (!current.platformFailure) next.platform_failure = current.kinds.platform_failure;
  let saved = validNotificationKinds((await session.saveNotificationSettings(next))?.kinds);
  if (!saved) throw new MnemosAPIError(502);
  return { kinds: saved, platformFailure: current.platformFailure };
}

function checkedObject(value: unknown): NotificationObject {
  let object = validNotificationObject(value);
  if (!object) throw new MnemosAPIError(400);
  return object;
}

/** Область уведомления, если человек в ней согласующий и ещё не решил; иначе null. Уведомление
 *  приходит на одну область — кнопка решает ровно её, а не все области человека. */
function myPendingDomain(review: PublicationReview, me: string, domainId: string | undefined) {
  return review.domains.find(d => d.domain_id === domainId && d.approvers.includes(me) && !d.decisions.some(x => x.approver_id === me)) ?? null;
}

function reviewOpen(review: PublicationReview): boolean {
  return !review.stale && !review.withdrawn;
}

const CLOSED: NotificationDecisionTicket = { version: null, details: [] };

/** Подготовка кнопок при отправке уведомления. Объекты без решения кнопкой — CLOSED. */
export async function prepareNotificationDecision(session: NotificationSession, value: unknown): Promise<NotificationDecisionTicket> {
  let object = checkedObject(value);
  try {
    switch (object.type) {
      case "publication_review": {
        let review = await session.readPublicationReview(object.id);
        let me = (await session.whoAmI()).subject.user_id;
        if (review.candidate_id !== object.id || !reviewOpen(review)) return CLOSED;
        let mine = myPendingDomain(review, me, object.domain_id);
        if (!mine) return CLOSED;
        return { version: review.decision_version, details: [`Документов на согласовании: ${new Set(mine.node_ids).size}`] };
      }
      case "share_request": {
        let found = (await session.listShareRequests(false)).requests.find(r => r.request_id === object.id);
        if (!found || found.status !== "pending") return CLOSED;
        let level = found.level === "organization" ? "всей организации" : found.level === "department" ? (found.org_unit_name ? `отделу «${found.org_unit_name}»` : "отделу") : "только автору";
        return { version: 0, details: [`Кто просит: ${found.requested_by_name}`, `Открыть ${level}${found.can_edit ? ", с правом правки" : ", только чтение"}`] };
      }
      case "collaboration": {
        let progress = await session.readCollaborationProgress(object.id);
        if (progress.state !== "awaiting_review") return CLOSED;
        return { version: progress.result_sequence, details: [] };
      }
      default:
        return CLOSED;
    }
  } catch (error) {
    // Объект уже недоступен (решён, отозван, снят доступ) — уведомление уходит без кнопок.
    if (error instanceof MnemosAPIError && [403, 404, 409, 410].includes(error.status)) return CLOSED;
    throw error;
  }
}

function staleByStatus(error: unknown, reason: string): NotificationDecisionResult | null {
  if (!(error instanceof MnemosAPIError)) return null;
  if (error.status === 409 && error.code === PRIVATE_CODE_CONSENT) return { status: "site", reason: "Нужно подтвердить открытие кода проекта — решите на сайте." };
  if ([404, 409, 410, 412].includes(error.status)) return { status: "stale", reason };
  if (error.status === 403) return { status: "stale", reason: "Решение больше не за вами." };
  return null;
}

/** Решение кнопкой от имени человека. version — из подготовки при отправке. */
export async function decideNotification(session: NotificationSession, value: unknown, version: unknown, decision: unknown): Promise<NotificationDecisionResult> {
  let object = checkedObject(value);
  if (!Number.isSafeInteger(version) || (version as number) < 0 || (decision !== "approve" && decision !== "reject")) throw new MnemosAPIError(400);
  let approve = decision === "approve";
  let done: NotificationDecisionResult = { status: approve ? "approved" : "rejected" };
  switch (object.type) {
    case "publication_review": {
      try {
        const review = await session.readPublicationReview(object.id);
        if (review.candidate_id !== object.id || !reviewOpen(review)) return { status: "stale", reason: "Согласование закрыто или устарело." };
        if (review.decision_version !== version) return { status: "stale", reason: "Согласование изменилось после уведомления — посмотрите его на сайте." };
        let me = (await session.whoAmI()).subject.user_id;
        let mine = myPendingDomain(review, me, object.domain_id);
        if (!mine) return { status: "stale", reason: "Вы уже решили по этому согласованию." };
        await session.recordReviewDecision(object.id, mine.domain_id, review.decision_version, approve);
        return done;
      } catch (error) {
        let stale = staleByStatus(error, "Согласование изменилось — посмотрите его на сайте.");
        if (stale) return stale;
        throw error;
      }
    }
    case "share_request": {
      try {
        let out = await session.decideShareRequest(object.id, approve);
        if (out.status === "pending") throw new MnemosAPIError(502);
        return out.status === "superseded" ? { status: "stale", reason: "Запрос заменён более новым." } : done;
      } catch (error) {
        let stale = staleByStatus(error, "Запрос уже решён или отозван.");
        if (stale) return stale;
        throw error;
      }
    }
    case "collaboration": {
      // Вернуть на доработку можно только с комментарием: это решается на сайте.
      if (!approve) return { status: "site", reason: "Чтобы вернуть на доработку, напишите комментарий на сайте." };
      try {
        let progress = await session.readCollaborationProgress(object.id);
        if (progress.state !== "awaiting_review") return { status: "stale", reason: "Результат уже принят или возвращён." };
        if (progress.result_sequence !== version) return { status: "stale", reason: "Пришёл новый результат — посмотрите его на сайте." };
        await session.reviewCollaborationResult(object.id, {
          review_id: crypto.randomUUID(), expected_revision: progress.review_revision, result_sequence: progress.result_sequence,
          decision: "accepted", comment: "",
        });
        return done;
      } catch (error) {
        let stale = staleByStatus(error, "Результат изменился — посмотрите его на сайте.");
        if (stale) return stale;
        throw error;
      }
    }
    default:
      return { status: "site", reason: "Это уведомление решается на сайте." };
  }
}

export { NOTIFICATION_KINDS };
