import { useState } from "react";
import type { PublicationReview } from "../src/mnemos-api.ts";
import { useHost } from "./host.ts";
import { Button, Notice } from "./ui.tsx";
import { personName, UNNAMED_DOCUMENT } from "./data.ts";

export default function ReviewDetails({ review, names }: { review: PublicationReview; names: Map<string, string> }) {
  const host = useHost();
  const [preview, setPreview] = useState<{ node: string; before: string | null; after: string | null; loading: boolean; error: string } | null>(null);
  async function open(node: string) {
    setPreview({ node, before: null, after: null, loading: true, error: "" });
    try {
      const [before, after] = await Promise.all([
        host.downloadReviewText(review.candidate_id, node, review.decision_version, "before"),
        host.downloadReviewText(review.candidate_id, node, review.decision_version, "after"),
      ]);
      setPreview(current => current?.node === node ? { node, before, after, loading: false, error: "" } : current);
    } catch {
      setPreview(current => current?.node === node ? { ...current, loading: false, error: "Не удалось открыть эту версию. Обновите согласование и проверьте доступ." } : current);
    }
  }
  return <div className="space-y-3 text-[14px] leading-5">
    <p className="m-0 text-kumo-subtle">Нужны решения всех назначенных согласующих: одобрение одного направления не заменяет остальные.</p>
    <ul aria-label="Направления согласования" className="m-0 grid list-none gap-2 p-0">
      {review.domains.map(domain => <li key={domain.domain_id} className="rounded-[12px] border border-kumo-fill bg-kumo-overlay p-3">
        <div className="font-medium text-kumo-default">Направление {domain.domain_id}</div>
        <div className="mt-1 text-kumo-subtle">{domain.approvers.map(person => {
          const decision = domain.decisions.find(item => item.approver_id === person);
          return <div key={person}>{personName(person)}: {decision ? decision.approved ? "одобрено" : "отклонено" : "ожидает решения"}</div>;
        })}</div>
        <div className="mt-1 flex flex-wrap gap-1">{domain.node_ids.map(node => <Button key={node} variant="secondary" size="sm" onClick={() => void open(node)}>{names.get(`${review.project_id}/${node}`) || UNNAMED_DOCUMENT}</Button>)}</div>
      </li>)}
    </ul>
    {preview && <section aria-label="Изменения документа" className="rounded-[12px] border border-kumo-fill bg-kumo-overlay p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="m-0 text-[15px] font-semibold">{names.get(`${review.project_id}/${preview.node}`) || UNNAMED_DOCUMENT}</h3><Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Закрыть просмотр</Button></div>
      {preview.loading ? <Notice>Загрузка версии…</Notice> : preview.error ? <Notice tone="danger">{preview.error}</Notice> : <div className="grid gap-3 md:grid-cols-2">
        <div><h4 className="m-0 mb-1 text-[13px] font-medium text-kumo-subtle">До изменения</h4><pre className="m-0 whitespace-pre-wrap break-words font-serif text-[14px] leading-[22px]">{preview.before ?? "Нет текстового представления"}</pre></div>
        <div><h4 className="m-0 mb-1 text-[13px] font-medium text-kumo-subtle">Предлагаемая версия</h4><pre className="m-0 whitespace-pre-wrap break-words font-serif text-[14px] leading-[22px]">{preview.after ?? "Нет текстового представления"}</pre></div>
      </div>}
    </section>}
  </div>;
}
