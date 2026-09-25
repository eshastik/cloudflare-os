import { useState } from "react";
import { Check, MagnifyingGlass } from "@phosphor-icons/react";
import type { AdminPerson } from "../src/admin-people.ts";
import { useUi } from "./host.ts";
import { projectName, useLoad, type MemoryData } from "./data.ts";
import { Notice } from "./ui.tsx";
import { Pill, plural } from "./admin-ui.tsx";

/** Уход сотрудника (решение владельца 25.09.2026): его источники кода и связи репозиториев с проектами не ломаются
 * молча — администратор передаёт их другому человеку, и связи продолжают работать от его имени. */
export default function GitOwnershipTransfer({ person, people, data }: { person: AdminPerson; people: AdminPerson[]; data: MemoryData }) {
  const ui = useUi();
  const owned = useLoad(() => ui.readGitOwnership(person.userName), "Источники кода сотрудника не прочитаны.", [ui, person.userName]);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const value = owned.value;
  if (owned.loading && !value) return <Notice>Проверяем источники кода сотрудника…</Notice>;
  if (owned.error) return <Notice tone="danger">{owned.error}</Notice>;
  if (!value || (!value.connections.length && !value.links.length)) return null;
  const candidates = people.filter(p => p.userName !== person.userName && p.active !== false && `${p.displayName} ${p.userName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const receiver = people.find(p => p.userName === to);
  async function transfer() {
    if (busy || !to) return;
    setBusy(true); setNotice(null);
    try {
      const out = await ui.transferGitOwnership(person.userName, to);
      setNotice({ tone: "success", text: `Передано ${receiver?.displayName || "сотруднику"}: источников ${out.connections}, связей с проектами ${out.links}. Связи продолжают работать.` });
      setPicking(false); await owned.reload();
    } catch { setNotice({ tone: "danger", text: "Не передано. Обновите страницу и повторите." }); }
    finally { setBusy(false); }
  }
  const sourceWords = (c: { provider: string; name: string; installation_id?: string }) => c.installation_id ? `${c.name || "GitHub"} — через приложение` : c.provider === "gitea" ? "Внутреннее хранилище Mnemos" : `${c.name || c.provider} — ключ доступа`;
  return <section aria-label="Источники кода сотрудника" className="grid gap-2 rounded-xl border border-kumo-warning bg-kumo-warning-tint p-3 text-[13px] text-kumo-warning">
    <p className="m-0"><strong className="font-semibold">Сначала передайте код.</strong> От имени сотрудника работают {value.connections.length} {plural(value.connections.length, "источник", "источника", "источников")} и {value.links.length} {plural(value.links.length, "связь", "связи", "связей")} репозиториев с проектами — после удаления они остановятся.</p>
    <ul className="m-0 grid list-none gap-0.5 p-0 text-kumo-default">
      {value.connections.map(c => <li key={c.connection_id}>Источник: {sourceWords(c)}</li>)}
      {value.links.map(l => <li key={`${l.project_id}/${l.connection_id}/${l.repository_id}`}>Связь: {l.repository_name} → проект «{projectName(data.projects, l.project_id)}»</li>)}
    </ul>
    {!picking && <div><Pill tone="primary" disabled={busy} onClick={() => setPicking(true)}>Передать…</Pill></div>}
    {picking && <div className="grid gap-2">
      <label className="flex h-9 max-w-[360px] items-center gap-2 rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3">
        <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
        <input aria-label="Кому передать" value={search} onChange={e => setSearch(e.target.value)} placeholder="Кому передать" className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-kumo-default outline-none placeholder:text-kumo-inactive" />
      </label>
      <div role="radiogroup" aria-label="Новый владелец" className="grid max-h-[180px] max-w-[360px] gap-0.5 overflow-y-auto rounded-xl border border-kumo-fill bg-kumo-overlay p-1">
        {candidates.map(p => <button key={p.userName} type="button" role="radio" aria-checked={to === p.userName} disabled={busy} onClick={() => setTo(p.userName)}
          className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[14px] ${to === p.userName ? "bg-kumo-tint font-medium text-kumo-brand" : "text-kumo-default hover:bg-kumo-tint"}`}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{to === p.userName && <Check size={14} weight="bold" />}</span>
          <span className="min-w-0 flex-1 truncate">{p.displayName || "Сотрудник без имени"}</span>
        </button>)}
        {candidates.length === 0 && <p className="m-0 px-2.5 py-2 text-kumo-subtle">Никого не нашлось.</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="primary" disabled={busy || !to} onClick={() => void transfer()}>{busy ? "Передаём…" : receiver ? `Передать: ${receiver.displayName || "сотрудник"}` : "Выберите, кому"}</Pill>
        <Pill tone="ghost" disabled={busy} onClick={() => setPicking(false)}>Отмена</Pill>
      </div>
    </div>}
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
  </section>;
}
