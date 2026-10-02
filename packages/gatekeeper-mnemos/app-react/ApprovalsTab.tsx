import ReviewDetails from "./ReviewDetails.tsx";
import { useState } from "react";
import { useUi } from "./host.ts";
import { documentNames, projectName, publicationNodeName, type MemoryData, type PendingApproval } from "./data.ts";
import { Button, Row, RowText, StatusBadge } from "./ui.tsx";

/** Запись решения по направлению во «Входящих». */
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
  const documents = item.domain.node_ids.map(id => publicationNodeName(item.review, names, id));
  const [expanded, setExpanded] = useState(false);
  const pending = item.mine === null && !item.review.stale && !item.review.withdrawn;
  const state = item.review.withdrawn ? "Отозвано" : item.review.stale ? "Неактуально" : item.mine === true ? "Вы согласовали" : item.mine === false ? "Вы отклонили" : "Ждёт вас";
  return (
    <div className="border-t border-kumo-fill first:border-t-0"><Row className="items-start" data-review={item.review.candidate_id} data-decision="approve">
      <RowText
        title={<>{documents[0] || "Заявка на согласование"}{documents.length > 1 && <span className="ml-2 text-[12px] text-kumo-subtle">+{documents.length - 1}</span>}</>}
        note={projectName(data.projects, item.review.project_id)}
      />
      <StatusBadge tone={pending ? "warning" : item.mine === true ? "success" : "neutral"}>{state}</StatusBadge>
      <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Скрыть" : "Подробнее"}</Button>
      {pending && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" disabled={busy === key} onClick={() => decide(item, true)}>Согласовать</Button>
          <Button variant="secondary" size="sm" disabled={busy === key} onClick={() => decide(item, false)}>Отклонить</Button>
        </div>
      )}
    </Row>{expanded && <div className="px-4 pb-4"><ReviewDetails key={`${item.review.candidate_id}/${item.review.decision_version}`} review={item.review} names={names} /></div>}</div>
  );
}
