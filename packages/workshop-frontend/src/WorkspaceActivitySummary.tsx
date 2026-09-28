import { useEffect, useRef, useState } from "react";
import type { OwnWorkspaceActivity, WorkspaceActivityReporting } from "@gadgets/workshop-shared/api";
import { useAuthenticatedApi } from "./AuthContext";
import { GROUP_CARD, SECONDARY_PILL, SECTION_TITLE } from "./components/AppShell/pageStyles";

/** Minimal self-service view of observed shell activity; never an employee ranking. */
export default function WorkspaceActivitySummary() {
  const { authenticatedApi } = useAuthenticatedApi();
  const [activity, setActivity] = useState<OwnWorkspaceActivity | null>(null);
  const [reporting, setReporting] = useState<WorkspaceActivityReporting | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setActivity(null); setReporting(null); setNotice(""); setBusy(false);
    return () => { generation.current++; };
  }, [authenticatedApi]);
  async function refresh() {
    if (busy) return;
    const expected = generation.current;
    setActivity(null); setReporting(null); setNotice(""); setBusy(true);
    try {
      const [value, config] = await Promise.all([authenticatedApi.readOwnWorkspaceActivity(), authenticatedApi.getWorkspaceActivityReporting()]);
      if (generation.current === expected) { setActivity(value); setReporting(config); }
    } catch {
      if (generation.current === expected) setNotice("Данные активности недоступны.");
    } finally { if (generation.current === expected) setBusy(false); }
  }
  async function choose(accountId: number | null) {
    if (busy) return;
    const expected = generation.current;
    setBusy(true); setNotice(""); setReporting(null);
    try {
      await authenticatedApi.setWorkspaceActivityReporting(accountId);
      const config = await authenticatedApi.getWorkspaceActivityReporting();
      if (generation.current === expected) setReporting(config);
    } catch { if (generation.current === expected) setNotice("Не удалось изменить получателя. Обновите данные, чтобы проверить состояние."); }
    finally { if (generation.current === expected) setBusy(false); }
  }
  return <section aria-label="Моя активность в Mnemos" className="flex flex-col gap-2.5">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className={`${SECTION_TITLE} min-w-0 flex-1`}>Моя активность в Mnemos</h2>
      <button type="button" className={SECONDARY_PILL} disabled={busy} onClick={() => void refresh()}>{busy ? "Обновляю…" : "Обновить активность"}</button>
    </div>
    {notice && <p role="status" className="m-0 text-[13px] leading-5 text-kumo-danger">{notice}</p>}
    {(reporting || activity) && <div className={GROUP_CARD}>
      {activity && <ul className="m-0 list-none p-0">
        <li className="flex items-center justify-between gap-3 border-b border-kumo-tint px-[18px] py-3 text-[15px]">Рабочие сессии: {activity.sessions}</li>
        <li className="flex items-center justify-between gap-3 border-b border-kumo-tint px-[18px] py-3 text-[15px]">Активное время: {(activity.activeMs / 60000).toFixed(1)} мин</li>
        <li className="flex items-center justify-between gap-3 border-b border-kumo-tint px-[18px] py-3 text-[15px] last:border-b-0">Длительность сессий: {(activity.sessionElapsedMs / 60000).toFixed(1)} мин</li>
      </ul>}
      {reporting && <div className="flex flex-col gap-2 px-[18px] py-3">
        <label className="flex flex-col gap-1.5 text-[14px] text-kumo-default">Отправка активности в командный свод
          <select aria-label="Получатель активности" className="h-10 w-full rounded-lg border border-kumo-line bg-kumo-base px-3 text-[14px] text-kumo-default" disabled={busy} value={reporting.selectedAccountId ?? ""} onChange={event => void choose(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">Отключена</option>
            {reporting.selectedAccountId !== null && !reporting.accounts.some(a => a.id === reporting.selectedAccountId) && <option value={reporting.selectedAccountId} disabled>Недоступное подключение</option>}
            {reporting.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select></label>
        <p className="m-0 text-[13px] leading-5 text-kumo-subtle">{({ disabled: "Отправка отключена.", pending: "Ожидается первое событие.", sent: "Последнее событие доставлено.", unavailable: "Не удалось доставить последнее событие. Проверьте подключение." })[reporting.delivery]}</p>
      </div>}
    </div>}
    <p className="m-0 text-[13px] leading-5 text-kumo-subtle">Считается с начала сбора: действия в оболочке и открытых редакторах. Это оценка активности, а не времени внимания. Пауза дольше 30 минут начинает новую сессию.</p>
  </section>;
}
