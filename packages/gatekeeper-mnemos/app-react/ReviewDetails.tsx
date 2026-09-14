import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { PublicationReview } from "../src/mnemos-api.ts";
import { useHost } from "./host.ts";
import { Notice } from "./ui.tsx";

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
  return <div className="space-y-3 text-[13px]">
    <p>Версия согласования: {review.decision_version}. Требуются решения всех назначенных специалистов. Одобрение одной области не заменяет остальные.</p>
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead><tr><th className="p-2">Область</th><th className="p-2">Согласующие</th><th className="p-2">Документы</th></tr></thead>
        <tbody>{review.domains.map(domain => <tr key={domain.domain_id} className="border-t border-kumo-line">
          <td className="p-2 align-top">{domain.domain_id}</td>
          <td className="p-2 align-top">{domain.approvers.map(person => {
            const decision = domain.decisions.find(item => item.approver_id === person);
            return <div key={person}>{person}: {decision ? decision.approved ? "одобрено" : "отклонено" : "ожидает решения"}</div>;
          })}</td>
          <td className="p-2 align-top">{domain.node_ids.map(node => <div key={node}><Button variant="ghost" size="sm" onClick={() => void open(node)}>{names.get(`${review.project_id}/${node}`) || node}</Button></div>)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {preview && <section aria-label="Изменения документа" className="rounded-lg border border-kumo-line p-3">
      <div className="flex items-center justify-between"><h3>{names.get(`${review.project_id}/${preview.node}`) || preview.node}</h3><Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Закрыть просмотр</Button></div>
      {preview.loading ? <Notice>Загрузка версии…</Notice> : preview.error ? <Notice tone="danger">{preview.error}</Notice> : <div className="grid gap-3 md:grid-cols-2">
        <div><h4>До изменения</h4><pre className="whitespace-pre-wrap break-words font-sans">{preview.before ?? "Нет текстового представления"}</pre></div>
        <div><h4>Предлагаемая версия</h4><pre className="whitespace-pre-wrap break-words font-sans">{preview.after ?? "Нет текстового представления"}</pre></div>
      </div>}
    </section>}
  </div>;
}
