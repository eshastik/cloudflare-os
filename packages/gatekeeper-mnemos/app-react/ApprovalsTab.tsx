import TemplateApprovals from "./TemplateApprovals.tsx";
import ReviewDetails from "./ReviewDetails.tsx";
import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import { useUi } from "./host.ts";
import { documentNames, myApprovals, personName, projectName, UNNAMED_DOCUMENT, type MemoryData, type PendingApproval } from "./data.ts";
import { EmptyTab, Notice, Row, RowList, RowText, StatusBadge } from "./ui.tsx";

/** Запись решения по направлению; общая для «Согласований» и «Моей работы». */
export function useReviewDecision(data: MemoryData) {
  const ui = useUi();
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  async function decide(item: PendingApproval, approved: boolean) {
    const key = `${item.review.candidate_id}/${item.domain.domain_id}`;
    setBusy(key); setNotice(null);
    try {
      await ui.recordReviewDecision(item.review.candidate_id, item.domain.domain_id, item.review.decision_version, approved);
      setNotice({ tone: "success", text: approved ? "Одобрение записано" : "Отказ записан" });
      await data.reloadReviews();
    } catch {
      setNotice({ tone: "danger", text: "Решение не записано. Обновите список и повторите." });
    } finally {
      setBusy("");
    }
  }
  return { notice, busy, decide };
}

export function ApprovalRow({ item, data, busy, decide }: { item: PendingApproval; data: MemoryData; busy: string; decide(item: PendingApproval, approved: boolean): void }) {
  const names = documentNames(data.projects);
  const key = `${item.review.candidate_id}/${item.domain.domain_id}`;
  const approved = item.domain.decisions.filter(d => d.approved).length;
  const documents = item.domain.node_ids.map(id => names.get(`${item.review.project_id}/${id}`) || UNNAMED_DOCUMENT).join(", ");
  const [expanded, setExpanded] = useState(false);
  const pending = item.mine === null && !item.review.stale && !item.review.withdrawn;
  return (
    <div><Row className="items-start" data-review={item.review.candidate_id} data-decision="approve">
      <StatusBadge tone={item.review.stale ? "neutral" : "warning"}>{item.review.stale ? "Устарело" : "Согласование"}</StatusBadge>
      <RowText
        title={<>«{documents}» — ваше решение по направлению {item.domain.domain_id}</>}
        note={<>
          проект «{projectName(data.projects, item.review.project_id)}» · автор {personName(item.review.author_id)} · одобрений {approved} из {item.domain.approvers.length}
          {item.review.withdrawn && " · автор отозвал предложение"}
          {item.review.stale && " · предложение устарело: права, политика или общая версия изменились"}
          {item.mine === true && " · вы одобрили"}
          {item.mine === false && " · вы отклонили"}
        </>}
      />
      <Button variant="secondary" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "Скрыть детали" : "Проверить изменения"}</Button>
      {pending && (
        <div className="flex shrink-0 gap-1.5">
          <Button variant="secondary" size="sm" disabled={busy === key} onClick={() => decide(item, false)}>Отклонить</Button>
          <Button variant="primary" size="sm" disabled={busy === key} onClick={() => decide(item, true)}>Одобрить</Button>
        </div>
      )}
    </Row>{expanded && <div className="border-b border-kumo-line p-4"><ReviewDetails key={`${item.review.candidate_id}/${item.review.decision_version}`} review={item.review} names={names} /></div>}</div>
  );
}

export default function ApprovalsTab({ data }: { data: MemoryData }) {
  const { notice, busy, decide } = useReviewDecision(data);
  const userId = data.identity?.subject.user_id ?? "";
  const items = userId ? myApprovals(data.reviews, userId) : [];

  return (
    <section aria-label="Согласования">
      <div className="mb-3 flex items-center gap-3">
        <p className="m-0 flex-1 text-[12px] text-kumo-subtle">Предложения, где ваше решение требуется по направлению.</p>
        <Button variant="ghost" size="sm" disabled={data.reviewsLoading} onClick={() => void data.reloadReviews()}>Обновить</Button>
      </div>
      {notice && <div className="mb-3"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      {data.reviewsError && <div className="mb-3"><Notice tone="danger">{data.reviewsError}</Notice></div>}
      {items.length === 0 && !data.reviewsLoading && !data.reviewsError && <EmptyTab description="Предложений к публикации документов пока нет." />}
      {items.length > 0 && (
        <RowList>
          {items.map(item => <ApprovalRow key={`${item.review.candidate_id}/${item.domain.domain_id}`} item={item} data={data} busy={busy} decide={(i, a) => void decide(i, a)} />)}
        </RowList>
      )}
      {data.reviewsCursor && <div className="mt-3"><Button variant="secondary" size="sm" disabled={data.reviewsLoading} onClick={() => void data.loadMoreReviews()}>Показать ещё</Button></div>}
      <TemplateApprovals userId={userId}/>
    </section>
  );
}
