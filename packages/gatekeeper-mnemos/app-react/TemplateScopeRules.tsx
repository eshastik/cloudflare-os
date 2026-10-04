import { useRef, useState } from "react";
import type { TemplateReviewRequirement, TemplateScope, TemplateScopeConfig } from "../src/work-templates.ts";
import { validTemplateScopeConfig } from "../src/work-templates.ts";
import { useLoad } from "./data.ts";
import { useUi } from "./host.ts";
import { Field, FieldInput, Pill, PillSelect } from "./admin-ui.tsx";
import { Notice } from "./ui.tsx";

/** Требования области не утверждают содержимое и не выдают доступ к личному источнику. */
export default function TemplateScopeRules() {
  const ui = useUi();
  const [cursor, setCursor] = useState("");
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Map<string, TemplateScope>>(() => new Map());
  const scopes = useLoad(() => ui.listManagedTemplateScopes(cursor), "Области не прочитаны. Нужно полномочие на правила шаблонов.", [ui, cursor]);
  const people = useLoad(() => ui.listPeople(), "Список сотрудников не прочитан.", [ui]);
  const listedScope = scopes.value?.scopes.find(s => s.scope_id === selected);
  const confirmedScope = acknowledged.get(selected);
  const scope = listedScope && confirmedScope && confirmedScope.revision >= listedScope.revision ? confirmedScope : listedScope;
  const next = scopes.value?.next_cursor;
  function page(after: string) { setSelected(""); setCursor(after); }
  function remember(scope: TemplateScope) { setAcknowledged(all => new Map(all).set(scope.scope_id, scope)); }
  return <section aria-label="Правила шаблонов" className="grid gap-3">
    <h2 className="m-0 text-[17px] font-semibold">Согласование шаблонов</h2>
    <p className="m-0 text-[13px] text-kumo-subtle">Назначьте предметные направления и сотрудников, которые проверяют содержание. Каждый назначенный сотрудник должен принять решение. Разрешение распространить шаблон в область остаётся отдельным решением.</p>
    {scopes.loading && <Notice>Читаем области шаблонов…</Notice>}
    {scopes.error && <Notice tone="danger">{scopes.error}</Notice>}
    {!scopes.loading && !scopes.error && <>
      <PillSelect aria-label="Область правил шаблонов" value={selected} disabled={editing} onChange={e => setSelected(e.target.value)}>
        <option value="">Выберите область</option>
        {(scopes.value?.scopes ?? []).map(s => <option key={s.scope_id} value={s.scope_id}>{s.name}{s.enabled ? "" : " · отключена"}</option>)}
      </PillSelect>
      {!scopes.value?.scopes.length && <Notice>Области шаблонов ещё не настроены.</Notice>}
      <div className="flex gap-2">
        {cursor && <Pill disabled={editing} onClick={() => page("")}>К началу областей</Pill>}
        {next && <Pill disabled={editing} onClick={() => page(next)}>Следующие области</Pill>}
      </div>
      {scope && <ScopeRequirements key={scope.scope_id} initial={scope} initialCursor={cursor} people={people.value?.users ?? []} peopleError={people.error} peopleLoading={people.loading} onEditing={setEditing} onSaved={remember} />}
    </>}
    {scopes.error && <Pill onClick={() => void scopes.reload()}>Повторить чтение областей</Pill>}
  </section>;
}

function ScopeRequirements({ initial, initialCursor, people, peopleError, peopleLoading, onEditing, onSaved }: {
  initial: TemplateScope; people: { userName: string; displayName: string; active?: boolean }[];
  initialCursor: string;
  peopleError: string; peopleLoading: boolean; onEditing(value: boolean): void;
  onSaved(scope: TemplateScope): void;
}) {
  const ui = useUi();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<TemplateReviewRequirement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const lock = useRef(false);
  const names = new Map(people.map(p => [p.userName, p.displayName || p.userName]));
  const config: TemplateScopeConfig = { ...saved, review_requirements: (draft ?? saved.review_requirements ?? []).map(r => ({ domain_id: r.domain_id.trim(), approvers: [...r.approvers] })) };
  const invalid = !validTemplateScopeConfig(config) || config.review_requirements!.some(r => new TextEncoder().encode(r.domain_id).length > 255);
  function start() { setDraft((saved.review_requirements ?? []).map(r => ({ ...r, approvers: [...r.approvers] }))); setNotice(null); onEditing(true); }
  function finish() { setDraft(null); onEditing(false); }
  function cancel() { setDraft(null); onEditing(uncertain); }
  function change(index: number, patch: Partial<TemplateReviewRequirement>) { setDraft(all => all?.map((r, i) => i === index ? { ...r, ...patch } : r) ?? null); }
  async function save() {
    if (!draft || lock.current || uncertain || invalid || peopleLoading || peopleError) return;
    lock.current = true; setBusy(true); setNotice(null);
    try {
      const out = await ui.setTemplateScope(saved.scope_id, saved.revision, config);
      setSaved(out); onSaved(out); setUncertain(false); finish();
      setNotice({ tone: "success", text: "Требования сохранены. Уже отправленные предложения нужно согласовать заново по новым требованиям." });
    } catch {
      setUncertain(true);
      setNotice({ tone: "danger", text: "Изменение не подтверждено. Введённые требования сохранены на экране. Перед повторной записью загрузите текущие правила области." });
    } finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      let cursor = initialCursor; const seen = new Set<string>([cursor]);
      for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        const page = await ui.listManagedTemplateScopes(cursor);
        const current = page.scopes.find(s => s.scope_id === saved.scope_id);
        if (current) { setSaved(current); onSaved(current); setUncertain(false); setNotice(null); finish(); return; }
        if (!page.next_cursor || seen.has(page.next_cursor)) throw Error("scope unavailable");
        seen.add(page.next_cursor); cursor = page.next_cursor;
      }
      throw Error("scope not found in bounded page scan");
    } catch { setNotice({ tone: "danger", text: "Текущие правила не прочитаны. Введённые требования остаются на экране." }); }
    finally { lock.current = false; setBusy(false); }
  }
  const rows = draft ?? saved.review_requirements ?? [];
  return <div className="grid gap-3 rounded-xl border border-kumo-fill p-4 text-[14px]">
    <p className="m-0">Распространение в область разрешают: {saved.approvers.map(id => names.get(id) ?? id).join(", ")}. Эти назначения здесь не меняются.</p>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {peopleError && <Notice tone="danger">{peopleError}</Notice>}
    {!draft && !rows.length && <Notice>Отдельные предметные согласования не назначены.</Notice>}
    {rows.map((r, index) => <fieldset key={index} className="m-0 grid gap-2 rounded-xl border border-kumo-fill p-3">
      {draft ? <Field label="Направление"><FieldInput aria-label={`Направление шаблонов ${index + 1}`} value={r.domain_id} disabled={busy || uncertain} onChange={e => change(index, { domain_id: e.target.value })} /></Field> : <legend>{r.domain_id}</legend>}
      {draft ? <>
        {[...new Set([...people.filter(p => p.active !== false).map(p => p.userName), ...r.approvers])].map(id => <label key={id} className="flex items-center gap-2">
          <input type="checkbox" checked={r.approvers.includes(id)} disabled={busy || uncertain || peopleLoading || !!peopleError} onChange={e => change(index, { approvers: e.target.checked ? [...r.approvers, id] : r.approvers.filter(x => x !== id) })} />
          {names.get(id) ?? id}{people.find(p => p.userName === id)?.active === false ? " · сотрудник выбыл" : ""}
        </label>)}
        <Pill disabled={busy || uncertain} onClick={() => setDraft(all => all?.filter((_, i) => i !== index) ?? null)}>Убрать направление</Pill>
      </> : <p className="m-0">Согласуют: {r.approvers.map(id => names.get(id) ?? id).join(", ")}</p>}
    </fieldset>)}
    <div className="flex flex-wrap gap-2">
      {!draft && <Pill disabled={busy || uncertain || !!peopleError || peopleLoading} onClick={start}>Изменить требования</Pill>}
      {draft && <>
        <Pill disabled={busy || uncertain || draft.length >= 32} onClick={() => setDraft(all => [...(all ?? []), { domain_id: "", approvers: [] }])}>Добавить направление</Pill>
        <Pill tone="primary" disabled={busy || uncertain || invalid || !!peopleError || peopleLoading} onClick={() => void save()}>Сохранить требования</Pill>
        <Pill disabled={busy} onClick={cancel}>Отменить правку</Pill>
      </>}
      {uncertain && <Pill disabled={busy} onClick={() => void reload()}>Загрузить текущие правила вместо введённых</Pill>}
    </div>
    <p className="m-0 text-kumo-subtle">Назначения этой области действуют также при повышении шаблона из подчинённых областей. Автор предложения и владелец исходника не согласуют собственный материал.</p>
  </div>;
}
