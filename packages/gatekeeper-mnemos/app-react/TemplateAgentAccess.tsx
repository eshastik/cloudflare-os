import { useEffect, useRef, useState } from "react";
import type { TemplateAgentGrant } from "../src/work-templates.ts";
import { useLoad } from "./data.ts";
import { useUi } from "./host.ts";
import { Pill, PillSelect } from "./admin-ui.tsx";
import { Notice } from "./ui.tsx";

/** Человек выбирает область явно; список не выдаёт агенту разрешений. */
export default function TemplateAgentAccess({ binding }: { binding: string }) {
  const ui = useUi();
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState("");
  const [selected, setSelected] = useState("");
  const changed = () => setRefresh(n => n + 1);
  const scopes = useLoad(() => ui.listTemplateScopes(cursor), "Области шаблонов не прочитаны.", [ui, cursor]);
  const scope = scopes.value?.scopes.find(s => s.scope_id === selected);
  const next = scopes.value?.next_cursor;
  function page(next: string) { setSelected(""); setCursor(next); }
  return <section aria-label="Шаблоны агента" className="mt-3 grid gap-2 rounded-xl bg-kumo-base p-3">
    <p className="m-0">Разрешите агенту читать опубликованные шаблоны выбранной области. Ваши права проверяются при каждом обращении. Это не разрешение выполнять операции в проектах.</p>
    {scopes.loading && <Notice>Загрузка областей…</Notice>}
    {scopes.error && <Notice tone="danger">{scopes.error}</Notice>}
    {!scopes.loading && !scopes.error && <>
      <PillSelect aria-label="Область шаблонов агента" value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">Выберите область</option>
        {(scopes.value?.scopes ?? []).map(s => <option key={s.scope_id} value={s.scope_id}>{s.name}</option>)}
      </PillSelect>
      {!scopes.value?.scopes.length && <Notice>На этой странице нет доступных областей шаблонов.</Notice>}
      <div className="flex gap-2">
        {cursor && <Pill onClick={() => page("")}>К началу списка</Pill>}
        {next && <Pill onClick={() => page(next)}>Следующие области</Pill>}
      </div>
      {scope && <TemplateGrant key={JSON.stringify([binding, scope.scope_id])} binding={binding} scope={scope.scope_id} refresh={refresh} onChanged={changed} />}
    </>}
    {scopes.error && <Pill onClick={() => void scopes.reload()}>Повторить чтение областей</Pill>}
    <SavedTemplateGrants binding={binding} refresh={refresh} onChanged={changed} names={new Map((scopes.value?.scopes ?? []).map(s => [s.scope_id, s.name]))} />
  </section>;
}

function TemplateGrant({ binding, scope, refresh, onChanged, revokeOnly = false }: { binding: string; scope: string; refresh: number; onChanged(): void; revokeOnly?: boolean }) {
  const ui = useUi();
  const [grant, setGrant] = useState<TemplateAgentGrant | null>(null);
  const [busy, setBusy] = useState(true);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setGrant(null); setBusy(true); setNotice(null);
    void ui.readTemplateAgentGrant(binding, scope).then(value => {
      if (active) setGrant(value);
    }, () => {
      if (active) setNotice({ tone: "danger", text: "Разрешение не прочитано. Изменение недоступно до успешного чтения." });
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; mounted.current = false; };
  }, [ui, binding, scope, reload, refresh]);

  async function change(enabled: boolean) {
    if (busy || !grant || (revokeOnly && enabled)) return;
    setBusy(true); setNotice(null);
    try {
      const saved = await ui.setTemplateAgentGrant(binding, scope, grant.revision, enabled);
      if (!mounted.current) return;
      setGrant(saved);
      setNotice({ tone: "success", text: enabled ? "Разрешение выдано." : "Разрешение отозвано." });
      onChanged();
    } catch {
      if (!mounted.current) return;
      setGrant(null);
      setNotice({ tone: "danger", text: "Изменение не подтверждено. Прочитайте текущее разрешение: сервер мог сохранить его, даже если ответ потерян." });
    } finally { if (mounted.current) setBusy(false); }
  }

  return <div className="grid gap-2">
    <p className="m-0">{grant ? grant.enabled ? "Разрешение для этой области выдано." : grant.revision ? "Разрешение для этой области отозвано." : "Разрешение для этой области не выдано." : busy ? "Читаем разрешение…" : "Текущее разрешение неизвестно."}</p>
    <div className="flex flex-wrap gap-2">
      {grant && (!revokeOnly || grant.enabled) && <Pill tone="primary" disabled={busy} onClick={() => void change(!grant.enabled)}>{grant.enabled ? "Отозвать разрешение" : "Выдать разрешение"}</Pill>}
      <Pill disabled={busy} onClick={() => setReload(n => n + 1)}>Прочитать текущее разрешение</Pill>
    </div>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
  </div>;
}

function SavedTemplateGrants({ binding, names, refresh, onChanged }: { binding: string; names: Map<string, string>; refresh: number; onChanged(): void }) {
  const ui = useUi();
  const [cursor, setCursor] = useState("");
  const [selected, setSelected] = useState("");
  const grants = useLoad(() => ui.listTemplateAgentGrants(binding, cursor), "Сохранённые разрешения агента не прочитаны.", [ui, binding, cursor, refresh]);
  const rows = grants.value?.grants ?? [];
  const grant = rows.find(g => g.scope_id === selected);
  const next = grants.value?.next_cursor;
  function page(after: string) { setSelected(""); setCursor(after); }
  return <div className="mt-2 grid gap-2 border-t border-kumo-fill pt-3">
    <h4 className="m-0 text-[14px] font-medium">Сохранённые разрешения</h4>
    <p className="m-0 text-kumo-subtle">Отзыв доступен и после потери доступа к области. Для недоступных областей показан только идентификатор сохранённого разрешения.</p>
    {grants.loading && <Notice>Читаем сохранённые разрешения…</Notice>}
    {grants.error && <Notice tone="danger">{grants.error}</Notice>}
    {!grants.loading && !grants.error && <>
      {!rows.length ? <Notice>На этой странице нет сохранённых разрешений.</Notice> : <PillSelect aria-label="Сохранённое разрешение шаблонов" value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">Выберите разрешение</option>
        {rows.map(g => <option key={g.scope_id} value={g.scope_id}>{names.get(g.scope_id) ?? `Область ${g.scope_id}`} · {g.enabled ? "выдано" : "отозвано"}</option>)}
      </PillSelect>}
      {grant && <TemplateGrant key={JSON.stringify([binding, grant.scope_id])} binding={binding} scope={grant.scope_id} refresh={refresh} onChanged={onChanged} revokeOnly />}
      <div className="flex gap-2">
        {cursor && <Pill onClick={() => page("")}>К началу разрешений</Pill>}
        {next && <Pill onClick={() => page(next)}>Следующие разрешения</Pill>}
      </div>
    </>}
    <Pill disabled={grants.loading} onClick={() => void grants.reload()}>Обновить сохранённые разрешения</Pill>
  </div>;
}
