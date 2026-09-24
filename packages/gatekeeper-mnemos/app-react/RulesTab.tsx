import { useEffect, useRef, useState, type ReactNode } from "react";
import { PROJECT_VISIBILITIES, type ProjectSharingSettings, type ProjectVisibility } from "../src/project-sharing.ts";
import { useUi } from "./host.ts";
import { useLoad } from "./data.ts";
import { Notice } from "./ui.tsx";
import { Card } from "./admin-ui.tsx";

type Choice<V extends string> = { value: V; label: string };

const CREATE_BY: Choice<ProjectSharingSettings["project_create_by"]>[] = [
  { value: "everyone", label: "Все" }, { value: "heads", label: "Руководители" }, { value: "admins", label: "Администраторы" },
];
const DEPARTMENT_APPROVAL: Choice<ProjectSharingSettings["share_department_approval"]>[] = [
  { value: "none", label: "Сразу" }, { value: "head", label: "С согласия руководителя" },
];
const ORGANIZATION_BY: Choice<ProjectSharingSettings["share_organization_by"]>[] = [
  { value: "head", label: "Руководитель отдела" }, { value: "admin", label: "Только администратор" },
];
const ORGANIZATION_APPROVAL: Choice<ProjectSharingSettings["share_organization_approval"]>[] = [
  { value: "none", label: "Не нужно" }, { value: "admin", label: "Нужно" },
];
const NEW_PROJECT: Record<ProjectVisibility, string> = { private: "Создателю", department: "Его отделу", organization: "Всем" };

/** Строка правила: название и пояснение слева, выбор справа. */
function RuleRow({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <div role="group" aria-label={title} className="grid items-center gap-3 border-t border-kumo-fill px-5 py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
    <div className="min-w-0">
      <div className="text-[15px] font-medium text-kumo-default">{title}</div>
      <div className="mt-0.5 text-[13px] leading-[18px] text-kumo-subtle">{note}</div>
    </div>
    <div className="justify-self-start sm:justify-self-end">{children}</div>
  </div>;
}

/** Выбор из двух-трёх вариантов одной строкой: видно все варианты сразу, без раскрывающегося списка. */
function Segmented<V extends string>({ label, value, options, disabled, onChange }: {
  label: string; value: V; options: Choice<V>[]; disabled: boolean; onChange(value: V): void;
}) {
  return <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-kumo-tint p-1">
    {options.map(option => {
      const active = option.value === value;
      return <button key={option.value} type="button" role="radio" aria-checked={active} disabled={disabled}
        onClick={() => { if (!active) onChange(option.value); }}
        className={`h-8 whitespace-nowrap rounded-full border-0 px-3.5 text-[13px] font-medium transition-colors disabled:cursor-default ${active ? "bg-kumo-overlay text-kumo-default shadow-[0_1px_2px_rgba(24,32,28,0.12)]" : "bg-transparent text-kumo-subtle hover:text-kumo-default"}`}>
        {option.label}
      </button>;
    })}
  </div>;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange(value: boolean): void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
    className={`relative h-7 w-12 rounded-full border-0 transition-colors disabled:opacity-60 ${checked ? "bg-kumo-brand" : "bg-kumo-fill-hover"}`}>
    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(24,32,28,0.25)] transition-[left] ${checked ? "left-6" : "left-1"}`} />
  </button>;
}

/** «Правила»: как в организации создают проекты и делятся ими. Меняет администратор; каждое
 * изменение уходит на сервер сразу целым набором правил (любой набор допустим), при отказе
 * выбор возвращается к сохранённому. */
export default function RulesTab() {
  const ui = useUi();
  const current = useLoad(() => ui.readProjectSharingSettings(), "Правила проектов не прочитаны: возможно, сервер ещё не поддерживает их.", [ui]);
  const [rules, setRules] = useState<ProjectSharingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const saved = useRef<ProjectSharingSettings | null>(null);
  useEffect(() => { if (current.value) { setRules(current.value); saved.current = current.value; } }, [current.value]);

  async function change<K extends keyof ProjectSharingSettings>(key: K, value: ProjectSharingSettings[K]) {
    if (!rules || busy) return;
    const next = { ...rules, [key]: value };
    setRules(next); setBusy(true); setNotice(null);
    try {
      await ui.updateProjectSharingSettings(next);
      saved.current = next;
      setNotice({ tone: "success", text: "Сохранено." });
    } catch {
      setRules(saved.current);
      setNotice({ tone: "danger", text: "Не сохранилось. Правила меняет администратор организации; обновите страницу и повторите." });
    } finally { setBusy(false); }
  }

  return <section aria-label="Правила организации" className="grid max-w-[760px] gap-4">
    {current.error && <Notice tone="danger">{current.error}</Notice>}
    {!rules && current.loading && <Notice>Загрузка…</Notice>}
    {rules && <section aria-label="Правила проектов" className="grid gap-3">
      <Card>
        <RuleRow title="Личные проекты у сотрудников" note="Каждый может вести проект, который видит только он.">
          <Toggle label="Личные проекты у сотрудников" checked={rules.personal_projects_enabled} disabled={busy} onChange={v => void change("personal_projects_enabled", v)} />
        </RuleRow>
        <RuleRow title="Кто создаёт проекты" note="Остальные работают в проектах, куда их пригласили.">
          <Segmented label="Кто создаёт проекты" value={rules.project_create_by} options={CREATE_BY} disabled={busy} onChange={v => void change("project_create_by", v)} />
        </RuleRow>
        <RuleRow title="Кто видит новый проект" note="Потом доступ можно расширить кнопкой «Поделиться».">
          <Segmented label="Кто видит новый проект" value={rules.default_visibility}
            options={PROJECT_VISIBILITIES.map(value => ({ value, label: NEW_PROJECT[value] }))} disabled={busy} onChange={v => void change("default_visibility", v)} />
        </RuleRow>
      </Card>
      <Card>
        <RuleRow title="Открыть проект своему отделу" note="Когда автор делится проектом с отделом.">
          <Segmented label="Открыть проект своему отделу" value={rules.share_department_approval} options={DEPARTMENT_APPROVAL} disabled={busy} onChange={v => void change("share_department_approval", v)} />
        </RuleRow>
        <RuleRow title="Открыть проект всей организации" note="Кто может сделать проект видимым всем сотрудникам.">
          <Segmented label="Открыть проект всей организации" value={rules.share_organization_by} options={ORGANIZATION_BY} disabled={busy} onChange={v => void change("share_organization_by", v)} />
        </RuleRow>
        <RuleRow title="Согласие администратора на это" note="Проект откроется всем только после согласия администратора.">
          <Segmented label="Согласие администратора на это" value={rules.share_organization_approval} options={ORGANIZATION_APPROVAL} disabled={busy} onChange={v => void change("share_organization_approval", v)} />
        </RuleRow>
      </Card>
      <div aria-live="polite" className="min-h-[20px]">{busy ? <span className="text-[13px] text-kumo-subtle">Сохраняем…</span> : notice && <Notice tone={notice.tone}>{notice.text}</Notice>}</div>
    </section>}
    <p className="m-0 text-[13px] text-kumo-subtle">Согласования документов задаются в каждом проекте — на его странице, в блоке «Согласование». Запросы на согласование приходят во «Входящие». Изменения правил применяются сразу.</p>
  </section>;
}
