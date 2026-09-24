import { useEffect, useState } from "react";
import { PROJECT_VISIBILITIES, VISIBILITY_TITLES, type ProjectSharingSettings, type ProjectVisibility, type ShareRequest } from "../src/project-sharing.ts";
import { useUi } from "./host.ts";
import { useLoad, type ProjectData } from "./data.ts";
import { Button, Notice, Select, StatusBadge } from "./ui.tsx";

export const VISIBILITY_NOTES: Record<ProjectVisibility, string> = {
  private: "Проект видите вы и те, кого вы пригласили.",
  department: "Проект видят коллеги по вашему отделу.",
  organization: "Проект видят все сотрудники организации.",
};

function deciderWords(request?: Pick<ShareRequest, "decider"> | null): string {
  return request?.decider === "admin" ? "администратора" : "руководителя отдела";
}

/** Кому виден проект — коротко, для шапки страницы проекта. */
export function VisibilityBadge({ project }: { project: ProjectData }) {
  if (!project.visibility) return null;
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    <StatusBadge tone="neutral">{VISIBILITY_TITLES[project.visibility]}{project.canEdit && project.visibility !== "private" ? " · могут править" : ""}</StatusBadge>
    {project.pendingShare && <StatusBadge tone="warning">Ждёт подтверждения руководителя</StatusBadge>}
  </span>;
}

/** «Поделиться»: три уровня словами и переключатель «могут править». Решает сервер: сразу или через руководителя. */
export function SharePanel({ project, onClose, onChanged }: { project: ProjectData; onClose(): void; onChanged(): Promise<void> }) {
  const ui = useUi();
  const [level, setLevel] = useState<ProjectVisibility>(project.pendingShare ?? project.visibility ?? "private");
  const [canEdit, setCanEdit] = useState(!!project.canEdit);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger" | "neutral"; text: string } | null>(null);
  const unchanged = level === (project.visibility ?? "private") && canEdit === !!project.canEdit && !project.pendingShare;

  async function save() {
    if (busy) return;
    setBusy(true); setResult(null);
    try {
      const out = await ui.setProjectVisibility(project.id, level, level === "private" ? false : canEdit);
      setResult(out.applied
        ? { tone: "success", text: level === "private" ? "Проект снова виден только вам." : `Готово: проект открыт — «${VISIBILITY_TITLES[out.visibility]}».` }
        : { tone: "neutral", text: `Ждёт подтверждения ${deciderWords(out.request)}. Вы увидите решение здесь и во «Входящих».` });
      await onChanged();
    } catch {
      setResult({ tone: "danger", text: "Не получилось поделиться. Поделиться проектом может тот, кто вправе его править; правила организации тоже могут это ограничивать." });
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Поделиться проектом" className="mb-7 rounded-[16px] border border-kumo-fill bg-kumo-overlay p-5">
      <h3 className="m-0 mb-1 text-[17px] font-semibold text-kumo-default">Кто видит проект «{project.name}»</h3>
      {project.pendingShare && <p className="mt-0 mb-2 text-[13px] text-kumo-warning">Ждёт подтверждения руководителя: «{VISIBILITY_TITLES[project.pendingShare]}».</p>}
      <div role="radiogroup" aria-label="Кто видит проект" className="mt-2 grid gap-2">
        {PROJECT_VISIBILITIES.map(value => (
          <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-[12px] border px-3.5 py-3 text-[14px] ${level === value ? "border-kumo-brand bg-kumo-tint" : "border-kumo-fill"}`}>
            <input type="radio" name={`visibility-${project.id}`} value={value} checked={level === value} disabled={busy} onChange={() => setLevel(value)} className="mt-1 accent-kumo-brand" />
            <span><span className="block font-medium text-kumo-default">{VISIBILITY_TITLES[value]}</span><span className="block text-[13px] text-kumo-subtle">{VISIBILITY_NOTES[value]}</span></span>
          </label>
        ))}
      </div>
      {level !== "private" && <label className="mt-3 flex items-center gap-2 text-[14px] text-kumo-default">
        <input type="checkbox" role="switch" aria-checked={canEdit} checked={canEdit} disabled={busy} onChange={e => setCanEdit(e.target.checked)} className="h-4 w-4 accent-kumo-brand" />
        Могут править
        <span className="text-kumo-subtle">— без этого видящие только читают</span>
      </label>}
      {result && <div className="mt-3"><Notice tone={result.tone}>{result.text}</Notice></div>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy || unchanged} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Закрыть</Button>
      </div>
    </section>
  );
}

const SETTING_TEXT = {
  project_create_by: { everyone: "все сотрудники", heads: "руководители отделов", admins: "только администраторы" },
  share_department_approval: { head: "с подтверждением руководителя", none: "сразу, без подтверждения" },
  share_organization_by: { head: "руководитель отдела", admin: "только администратор" },
  share_organization_approval: { none: "сразу", admin: "с подтверждением администратора" },
} as const;

/** Правила организации о проектах: раздел «Правила», только администратору. */
export function OrganizationSharingSettings() {
  const ui = useUi();
  const current = useLoad(() => ui.readProjectSharingSettings(), "Правила проектов не прочитаны: возможно, сервер ещё не поддерживает их.", [ui]);
  const [draft, setDraft] = useState<ProjectSharingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => { if (current.value) setDraft(current.value); }, [current.value]);
  const set = <K extends keyof ProjectSharingSettings>(key: K, value: ProjectSharingSettings[K]) => setDraft(d => d ? { ...d, [key]: value } : d);
  const changed = !!draft && !!current.value && JSON.stringify(draft) !== JSON.stringify(current.value);

  async function save() {
    if (!draft || busy) return;
    setBusy(true); setNotice(null);
    try { await ui.updateProjectSharingSettings(draft); setNotice({ tone: "success", text: "Правила сохранены." }); await current.reload(); }
    catch { setNotice({ tone: "danger", text: "Правила не сохранены. Их меняет администратор организации; обновите страницу и повторите." }); }
    finally { setBusy(false); }
  }
  const select = <K extends keyof typeof SETTING_TEXT>(key: K, label: string) => (
    <label className="grid gap-1 text-[13px] text-kumo-default">{label}
      <Select aria-label={label} value={draft ? String(draft[key]) : ""} disabled={busy || !draft} onChange={e => set(key, e.target.value as ProjectSharingSettings[K])}>
        {Object.entries(SETTING_TEXT[key]).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </Select>
    </label>
  );

  return (
    <section aria-label="Правила проектов" className="mt-2">
      {current.error && <Notice tone="danger">{current.error}</Notice>}
      {!draft && current.loading && <Notice>Загрузка…</Notice>}
      {draft && <div className="grid max-w-[520px] gap-3">
        <label className="flex items-center gap-2 text-[13px] text-kumo-default">
          <input type="checkbox" role="switch" aria-checked={draft.personal_projects_enabled} checked={draft.personal_projects_enabled} disabled={busy} onChange={e => set("personal_projects_enabled", e.target.checked)} />
          Личные проекты у сотрудников
        </label>
        {select("project_create_by", "Кто создаёт проекты")}
        {select("share_department_approval", "Поделиться с отделом")}
        {select("share_organization_by", "Кто открывает проект всей организации")}
        {select("share_organization_approval", "Открытие всей организации")}
        <label className="grid gap-1 text-[13px] text-kumo-default">Кто видит новый проект
          <Select aria-label="Кто видит новый проект" value={draft.default_visibility} disabled={busy} onChange={e => set("default_visibility", e.target.value as ProjectVisibility)}>
            {PROJECT_VISIBILITIES.map(value => <option key={value} value={value}>{VISIBILITY_TITLES[value]}</option>)}
          </Select>
        </label>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <div><Button variant="primary" size="sm" disabled={busy || !changed} onClick={() => void save()}>Сохранить правила</Button></div>
      </div>}
    </section>
  );
}
