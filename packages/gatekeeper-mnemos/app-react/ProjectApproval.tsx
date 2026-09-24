import { useState } from "react";
import type { PolicyDomain, PublicationPolicy } from "../src/mnemos-api.ts";
import { useUi } from "./host.ts";
import { personName, UNNAMED_DOCUMENT, useLoad, type ProjectData } from "./data.ts";
import { Button, Chip, Notice, SectionTitle, TextInput } from "./ui.tsx";

/** «Согласование» на странице проекта: кто согласует какие документы. Правка — прямо здесь, без отдельного экрана. */
export default function ProjectApproval({ project }: { project: ProjectData }) {
  const ui = useUi();
  const policy = useLoad(() => ui.readPublicationPolicy(project.id), "Правила согласования не прочитаны: нет права или сервер отказал.", [ui, project.id]);
  const approvers = useLoad(async () => {
    const all: { principal_id: string; display_name: string }[] = []; let cursor = "";
    for (let page = 0; page < 10; page++) { const out = await ui.listPolicyApprovers(project.id, cursor); all.push(...out.approvers); cursor = out.next_cursor; if (!cursor) break; }
    return all;
  }, "Список согласующих не прочитан.", [ui, project.id]);
  const [draft, setDraft] = useState<PolicyDomain[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const names = new Map((approvers.value ?? []).map(a => [a.principal_id, a.display_name || personName(a.principal_id)]));
  const docName = (id: string) => project.nodes.find(n => n.node_id === id)?.name || project.privateDocs.get(id)?.name || UNNAMED_DOCUMENT;
  const files = project.nodes.filter(n => !n.is_dir);
  const editing = draft !== null;
  const invalid = !!draft && (!draft.length || draft.some(d => !d.domain_id.trim() || (!d.all_documents && !d.node_ids.length) || !d.approver_ids.length) || new Set(draft.map(d => d.domain_id.trim())).size !== draft.length);
  const change = (index: number, patch: Partial<PolicyDomain>) => setDraft(all => all!.map((d, i) => i === index ? { ...d, ...patch } : d));
  const toggle = (list: string[], id: string, on: boolean) => on ? [...new Set([...list, id])] : list.filter(x => x !== id);

  async function save() {
    const current: PublicationPolicy | null = policy.value;
    if (!draft || !current || busy || invalid) return;
    setBusy(true); setNotice(null);
    try {
      await ui.setPublicationPolicy(project.id, current.revision, draft.map(d => ({ ...d, domain_id: d.domain_id.trim() })));
      setNotice({ tone: "success", text: "Правила согласования сохранены. Уже отправленные изменения нужно отправить на согласование заново." });
      setConfirming(false);
      setDraft(null);
      await policy.reload();
    } catch { setNotice({ tone: "danger", text: "Не сохранилось: правила могли поменяться. Обновите страницу и повторите." }); }
    finally { setBusy(false); }
  }

  const coversAll = !!policy.value?.domains.some(d => d.all_documents);
  return <section aria-label="Согласование" className="mb-7">
    <SectionTitle title="Согласование" actions={!editing && policy.value ? <Button variant="ghost" size="sm" onClick={() => { setNotice(null); setDraft(policy.value!.domains.map(d => ({ ...d, node_ids: [...d.node_ids], approver_ids: [...d.approver_ids] }))); }}>Изменить</Button> : undefined} />
    {policy.error && <Notice tone="danger">{policy.error}</Notice>}
    {notice && <div className="mb-2"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
    {!editing && policy.value && (policy.value.domains.length === 0 ? <Notice>Публикация в этом проекте не требует согласования.</Notice> :
      <div>{policy.value.domains.map(d => <div key={d.domain_id} className="flex items-start gap-3 border-b border-kumo-fill py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-5 text-kumo-default">{d.all_documents ? "Все документы проекта, включая новые" : d.node_ids.map(docName).join(", ")}</div>
          <div className="mt-0.5 text-[13px] text-kumo-subtle">согласуют: {d.approver_ids.map(id => names.get(id) ?? personName(id)).join(", ") || "никто не назначен"}</div>
        </div>
        <Chip>{d.domain_id}</Chip>
      </div>)}
      {!coversAll && <p className="m-0 mt-2 text-[13px] text-kumo-subtle">Остальное публикуется сразу.</p>}</div>)}
    {editing && <div className="grid gap-3 text-[14px]">
      {draft!.map((d, index) => <fieldset key={index} className="m-0 grid gap-2 rounded-[16px] border border-kumo-fill bg-kumo-overlay p-4">
        <label className="grid gap-1">Название направления<TextInput aria-label={`Название направления ${index + 1}`} value={d.domain_id} disabled={busy} onChange={e => change(index, { domain_id: e.target.value })} placeholder="Например, Юридическая проверка" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-kumo-brand" checked={!!d.all_documents} disabled={busy} onChange={e => change(index, { all_documents: e.target.checked, node_ids: e.target.checked ? [] : d.node_ids })} />Все документы проекта, включая новые</label>
        {!d.all_documents && <div className="grid gap-1"><span className="text-kumo-subtle">Документы</span>
          {files.length === 0 && <span className="text-kumo-subtle">В проекте пока нет документов.</span>}
          {files.map(f => <label key={f.node_id} className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-kumo-brand" checked={d.node_ids.includes(f.node_id)} disabled={busy} onChange={e => change(index, { node_ids: toggle(d.node_ids, f.node_id, e.target.checked) })} />{f.name || UNNAMED_DOCUMENT}</label>)}
        </div>}
        <div className="grid gap-1"><span className="text-kumo-subtle">Кто согласует</span>
          {(approvers.value ?? []).map(a => <label key={a.principal_id} className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-kumo-brand" checked={d.approver_ids.includes(a.principal_id)} disabled={busy} onChange={e => change(index, { approver_ids: toggle(d.approver_ids, a.principal_id, e.target.checked) })} />{a.display_name || "Сотрудник без имени"}</label>)}
          {approvers.error && <Notice tone="danger">{approvers.error}</Notice>}
        </div>
        <div><Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(all => all!.filter((_, i) => i !== index))}>Убрать направление</Button></div>
      </fieldset>)}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setDraft(all => [...all!, { domain_id: "", node_ids: [], approver_ids: [] }])}>Добавить направление</Button>
        {!confirming && <Button size="sm" disabled={busy || invalid} onClick={() => setConfirming(true)}>Сохранить</Button>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(null); setConfirming(false); }}>Отмена</Button>
      </div>
      {invalid && <Notice>У каждого направления должно быть своё название, документы и хотя бы один согласующий.</Notice>}
      {confirming && <div role="region" aria-label="Подтверждение правил" className="grid gap-2 rounded-[12px] bg-kumo-tint p-3">
        <p className="m-0">Сохранить новые правила? Изменения, уже отправленные на согласование, придётся отправить заново.</p>
        <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void save()}>Да, сохранить</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>Отмена</Button></div>
      </div>}
    </div>}
  </section>;
}
