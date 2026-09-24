import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import { useUi } from "./host.ts";
import { useLoad, type CollaborationItem } from "./data.ts";
import { Notice } from "./ui.tsx";

/** Приёмка результата поручения прямо во «Входящих»: что просили, что сделано, решение. */
export default function AcceptanceReview({ item, onDone }: { item: CollaborationItem; onDone(): Promise<void> }) {
  const ui = useUi();
  const r = item.request;
  const messages = useLoad(async () => (await ui.listCollaborationMessages(r.request_id, 0)).messages, "Результат не прочитан. Обновите страницу.", [ui, r.request_id]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const result = (messages.value ?? []).filter(m => m.kind === "result").at(-1);

  async function decide(decision: "accepted" | "changes_requested") {
    if (busy || !item.progress) return;
    const text = comment.trim() || (decision === "accepted" ? "Результат принят." : "");
    if (!text) { setNotice({ tone: "danger", text: "Напишите, что нужно доработать." }); return; }
    setBusy(true); setNotice(null);
    try {
      await ui.reviewCollaborationResult(r.request_id, { review_id: crypto.randomUUID(), expected_revision: item.progress.review_revision, result_sequence: item.progress.result_sequence, decision, comment: text });
      setNotice({ tone: "success", text: decision === "accepted" ? "Результат принят." : "Работа возвращена на доработку." });
      await onDone();
    } catch {
      setNotice({ tone: "danger", text: "Решение не записано: результат мог измениться. Обновите страницу и проверьте ещё раз." });
    } finally { setBusy(false); }
  }

  return <div className="space-y-3 text-[13px]">
    {r.description && <p className="m-0 whitespace-pre-wrap">{r.description}</p>}
    {r.criteria && <p className="m-0 text-kumo-subtle">Что должно получиться: {r.criteria}</p>}
    {messages.loading && <Notice>Загружаем результат…</Notice>}
    {messages.error && <Notice tone="danger">{messages.error}</Notice>}
    {result && <div aria-label="Результат" className="whitespace-pre-wrap rounded-lg border border-kumo-line bg-kumo-elevated p-3">{result.body}</div>}
    {!messages.loading && !messages.error && !result && <Notice>Текст результата не приложен.</Notice>}
    <label className="grid gap-1">Комментарий
      <textarea aria-label="Комментарий к приёмке" rows={3} value={comment} disabled={busy} onChange={e => setComment(e.target.value)}
        className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-base p-2 text-[13px] text-kumo-default outline-none focus:border-kumo-ring" />
    </label>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    <div className="flex gap-2">
      <Button variant="primary" size="sm" disabled={busy || !item.progress} onClick={() => void decide("accepted")}>Принять</Button>
      <Button variant="secondary" size="sm" disabled={busy || !item.progress} onClick={() => void decide("changes_requested")}>Вернуть на доработку</Button>
    </div>
  </div>;
}
