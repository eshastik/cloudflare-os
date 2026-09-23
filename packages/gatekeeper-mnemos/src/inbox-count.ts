import type { CollaborationProgress, CollaborationRequest, PublicationReview } from "./mnemos-api.ts";

/** Обращение с его текущим состоянием; состояние может быть не прочитано. */
export interface InboxCollaboration { request: CollaborationRequest; progress: CollaborationProgress | null }

/** Число решений, которые ждут человека во «Входящих»: согласования, публикация одобренного и приёмка работы.
 * Один подсчёт для экрана и для счётчика в навигации, чтобы числа не расходились. */
export function inboxDecisions(reviews: PublicationReview[], collaborations: InboxCollaboration[], userId: string): number {
  if (!userId) return 0;
  let approvals = 0;
  for (const review of reviews) {
    if (review.stale) continue;
    for (const domain of review.domains) {
      if (domain.approvers.includes(userId) && !domain.decisions.some(d => d.approver_id === userId)) approvals++;
    }
  }
  const publishable = reviews.filter(review => review.author_id === userId && review.ready && !review.stale).length;
  const acceptance = collaborations.filter(item => item.request.requester_user_id === userId && item.progress?.state === "awaiting_review").length;
  return approvals + publishable + acceptance;
}
