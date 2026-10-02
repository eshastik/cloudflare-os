import { useState } from "react";
import { countPublicationNodes } from "@gadgets/workshop-shared/publication-review";
import type { PublicationReview } from "../src/mnemos-api.ts";
import { useHost } from "./host.ts";
import { FileText } from "@phosphor-icons/react";
import { plural } from "./names.ts";
import { Button, Notice } from "./ui.tsx";
import { personName, publicationNodeName } from "./data.ts";

export default function ReviewDetails({ review, names }: { review: PublicationReview; names: Map<string, string> }) {
  const host = useHost();
  const counts = countPublicationNodes(review);
  const nodes = [...new Set(review.domains.flatMap(domain => domain.node_ids))];
  const inactive = review.stale || review.withdrawn;
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ node: string; before: string | null; after: string | null; loading: boolean; error: string } | null>(null);
  async function open(node: string) {
    if (loading) return;
    setLoading(true);
    setPreview({ node, before: null, after: null, loading: true, error: "" });
    try {
      const before = await host.downloadReviewText(review.candidate_id, node, review.decision_version, "before");
      const after = await host.downloadReviewText(review.candidate_id, node, review.decision_version, "after");
      setPreview(current => current?.node === node ? { node, before, after, loading: false, error: "" } : current);
    } catch {
      setPreview(current => current?.node === node ? { ...current, loading: false, error: "Не удалось открыть эту версию. Обновите согласование и проверьте доступ." } : current);
    } finally { setLoading(false); }
  }
  return <div className="space-y-3 text-[14px] leading-5">
    {review.withdrawn ? <Notice>Автор отозвал заявку.</Notice> : review.stale ?
      <Notice>Версия или правила согласования изменились. Эта заявка больше не действует.</Notice> : null}
    {counts && <p className="m-0 text-[12px] text-kumo-subtle">{[
      counts.documents > 0 && `${counts.documents} ${plural(counts.documents, "документ", "документа", "документов")}`,
      counts.applications > 0 && `${counts.applications} ${plural(counts.applications, "приложение", "приложения", "приложений")}`,
    ].filter(Boolean).join(" · ")}</p>}
    <div aria-label="Материалы заявки" className="flex flex-col items-start gap-1">
      {nodes.map(node => <Button key={node} variant="ghost" size="sm" disabled={loading} onClick={() => void open(node)} className="!h-auto max-w-full !justify-start gap-2 !py-2 text-left">
        <FileText size={16} className="shrink-0 text-kumo-subtle" />
        <span className="min-w-0 break-words">{publicationNodeName(review, names, node)}</span>
      </Button>)}
    </div>
    <details className="text-[12px] text-kumo-subtle">
      <summary className="cursor-pointer py-1 hover:text-kumo-default">Участники и правила согласования</summary>
      <div className="mt-2 space-y-3">
        <p className="m-0">Автор: {personName(review.author_id)}</p>
        {!inactive && <p className="m-0">Для согласования нужны решения всех назначенных участников.</p>}
        <ul aria-label="Направления согласования" className="m-0 list-none space-y-3 p-0">
          {review.domains.map(domain => <li key={domain.domain_id}>
            <p className="m-0 mb-1">Направление: {domain.domain_id}</p>
            {domain.approvers.map(person => {
              const decision = domain.decisions.find(item => item.approver_id === person);
              return <div key={person} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-0.5">
                <span>{personName(person)}:</span>{" "}
                <span>{decision ? decision.approved ? "одобрено" : "отклонено" : inactive ? "решение не принято" : "ожидает решения"}</span>
              </div>;
            })}
          </li>)}
        </ul>
      </div>
    </details>
    {preview && <section aria-label="Изменения документа" className="rounded-[12px] border border-kumo-fill bg-kumo-overlay p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="m-0 text-[15px] font-semibold">{publicationNodeName(review, names, preview.node)}</h3><Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Закрыть просмотр</Button></div>
      {preview.loading ? <Notice>Загрузка версии…</Notice> : preview.error ? <Notice tone="danger">{preview.error}</Notice> : <div className="grid gap-3 md:grid-cols-2">
        <div><h4 className="m-0 mb-1 text-[13px] font-medium text-kumo-subtle">До изменения</h4><pre className="m-0 whitespace-pre-wrap break-words font-serif text-[14px] leading-[22px]">{preview.before ?? "Нет текстового представления"}</pre></div>
        <div><h4 className="m-0 mb-1 text-[13px] font-medium text-kumo-subtle">Предлагаемая версия</h4><pre className="m-0 whitespace-pre-wrap break-words font-serif text-[14px] leading-[22px]">{preview.after ?? "Нет текстового представления"}</pre></div>
      </div>}
    </section>}
  </div>;
}
