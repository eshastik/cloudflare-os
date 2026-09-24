import { useEffect, useState, type ReactNode } from "react";
import { PROJECT_VISIBILITIES, type ProjectSharingSettings, type ProjectVisibility } from "../src/project-sharing.ts";
import { useUi } from "./host.ts";
import { useLoad } from "./data.ts";
import { Notice } from "./ui.tsx";
import { Card, Pill } from "./admin-ui.tsx";

const CHOICES = {
  project_create_by: { everyone: "Все сотрудники", heads: "Руководители отделов", admins: "Только администраторы" },
  share_department_approval: { head: "С согласия руководителя", none: "Сразу" },
  share_organization_by: { head: "Руководитель отдела", admin: "Только администратор" },
  share_organization_approval: { none: "Сразу", admin: "С согласия администратора" },
} as const;
const NEW_PROJECT: Record<ProjectVisibility, string> = { private: "Только создателю", department: "Его отделу", organization: "Всей организации" };

/** Строка правила: название и пояснение слева, выбор справа. */
function RuleRow({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <label className="flex flex-wrap items-center gap-3 border-t border-kumo-fill px-5 py-4 first:border-t-0 sm:flex-nowrap">
    <span className="block min-w-0 flex-1">
      <span className="block text-[15px] font-medium text-kumo-default">{title}</span>
      {note && <span className="block text-[13px] text-kumo-subtle">{note}</span>}
    </span>
    {children}
  </label>;
}
const SELECT = "h-9 max-w-full rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 text-[14px] text-kumo-default outline-none focus:border-kumo-ring disabled:opacity-60";

/** «Правила»: как в организации создают проекты и делятся ими. Меняет администратор; сервер проверяет каждое изменение.
 * Правила сохраняются одной кнопкой: частичный набор не уходит на сервер, пока человек не закончил выбор. */
export default function RulesTab() {
  const ui = useUi();
  const current = useLoad(() => ui.readProjectSharingSettings(), "Правила проектов не прочитаны: возможно, сервер ещё не поддерживает их.", [ui]);
  const [draft, setDraft] = useState<ProjectSharingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => { if (current.value) setDraft(current.value); }, [current.value]);
  const set = <K extends keyof ProjectSharingSettings>(key: K, value: ProjectSharingSettings[K]) => { setNotice(null); setDraft(d => d ? { ...d, [key]: value } : d); };
  const changed = !!draft && !!current.value && JSON.stringify(draft) !== JSON.stringify(current.value);

  async function save() {
    if (!draft || busy) return;
    setBusy(true); setNotice(null);
    try { await ui.updateProjectSharingSettings(draft); setNotice({ tone: "success", text: "Правила сохранены." }); await current.reload(); }
    catch { setNotice({ tone: "danger", text: "Правила не сохранены. Их меняет администратор организации; обновите страницу и повторите." }); }
    finally { setBusy(false); }
  }
  const choice = <K extends keyof typeof CHOICES>(key: K, title: string) => (
    <RuleRow title={title}>
      <select aria-label={title} className={SELECT} value={draft ? String(draft[key]) : ""} disabled={busy || !draft} onChange={e => set(key, e.target.value as ProjectSharingSettings[K])}>
        {Object.entries(CHOICES[key]).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </RuleRow>
  );

  return <section aria-label="Правила организации" className="grid max-w-[720px] gap-4">
    {current.error && <Notice tone="danger">{current.error}</Notice>}
    {!draft && current.loading && <Notice>Загрузка…</Notice>}
    {draft && <section aria-label="Правила проектов" className="grid gap-4">
      <Card>
        <RuleRow title="Личные проекты у сотрудников" note="Каждый может вести проект, который видит только он">
          <input type="checkbox" role="switch" aria-checked={draft.personal_projects_enabled} checked={draft.personal_projects_enabled} disabled={busy} onChange={e => set("personal_projects_enabled", e.target.checked)} className="h-5 w-5 accent-kumo-brand" />
        </RuleRow>
        {choice("project_create_by", "Кто создаёт проекты")}
        {choice("share_department_approval", "Поделиться с отделом")}
        {choice("share_organization_by", "Кто открывает проект всей организации")}
        {choice("share_organization_approval", "Открытие всей организации")}
        <RuleRow title="Кто видит новый проект">
          <select aria-label="Кто видит новый проект" className={SELECT} value={draft.default_visibility} disabled={busy} onChange={e => set("default_visibility", e.target.value as ProjectVisibility)}>
            {PROJECT_VISIBILITIES.map(value => <option key={value} value={value}>{NEW_PROJECT[value]}</option>)}
          </select>
        </RuleRow>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="primary" size="md" disabled={busy || !changed} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить правила"}</Pill>
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : changed && <span className="text-[13px] text-kumo-subtle">Есть несохранённые изменения.</span>}
      </div>
    </section>}
    <p className="m-0 text-[13px] text-kumo-subtle">Согласования: кто согласует документы, задаётся в каждом проекте — на его странице, в блоке «Согласование». Запросы на согласование приходят во «Входящие».</p>
  </section>;
}
