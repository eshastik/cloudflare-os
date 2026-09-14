import { useEffect, useRef, useState } from "react";
import type { OwnWorkspaceActivity, WorkspaceActivityReporting } from "@gadgets/workshop-shared/api";
import { useAuthenticatedApi } from "./AuthContext";

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
  return <section>
    <h2>Моя активность в Mnemos</h2>
    <button type="button" disabled={busy} onClick={() => void refresh()}>Обновить активность</button>
    {notice && <p role="status">{notice}</p>}
    {reporting && <div>
      <label>Отправка активности и времени загрузки в командный свод <select aria-label="Получатель активности" disabled={busy} value={reporting.selectedAccountId ?? ""} onChange={event => void choose(event.target.value === "" ? null : Number(event.target.value))}>
        <option value="">Отключена</option>
        {reporting.selectedAccountId !== null && !reporting.accounts.some(a => a.id === reporting.selectedAccountId) && <option value={reporting.selectedAccountId} disabled>Недоступное подключение</option>}
        {reporting.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
      </select></label>
      <p>{({ disabled: "Отправка отключена.", pending: "Ожидается первое событие.", sent: "Последнее событие доставлено.", unavailable: "Не удалось доставить последнее событие. Проверьте подключение." })[reporting.delivery]}</p>
    </div>}
    {activity && <p>Рабочие сессии: {activity.sessions} · Активное время: {(activity.activeMs / 60000).toFixed(1)} мин · Длительность сессий: {(activity.sessionElapsedMs / 60000).toFixed(1)} мин</p>}
    <p>С начала сбора. Учитываются взаимодействия в оболочке и открытых редакторах. Это оценка активности, а не времени внимания; пропущенные интервалы не добавляются. Пауза более 30 минут начинает новую рабочую сессию.</p>
  </section>;
}
