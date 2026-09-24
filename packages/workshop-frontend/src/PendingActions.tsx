import { useEffect, useState } from 'react'
import type { ActionLogEntry } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from './AuthContext'

type Pending = { workspace: string; title: string; action: ActionLogEntry }
/** Human approval inbox. All reads and decisions remain authorized by each workspace. */
export default function PendingActions() {
  const { authenticatedApi } = useAuthenticatedApi()
  const [rows, setRows] = useState<Pending[]>([])
  const [notice, setNotice] = useState('Загрузка…')
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(20)
  const [total, setTotal] = useState(0)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const spaces = await authenticatedApi.listGadgets()
      const result: Pending[] = []
      let unavailable = 0
      for (const space of spaces.slice(0, limit)) {
        if (cancelled) return
        try {
          using workspace = await authenticatedApi.openGadget(space.id)
          const actions = await workspace.listActions()
          for (const action of actions) if (action.state === 'pending') result.push({ workspace: space.id, title: space.title, action })
        } catch { unavailable++ }
      }
      if (!cancelled) { setRows(result); setTotal(spaces.length); setNotice(unavailable ? `Не прочитано пространств: ${unavailable}. Обновите список.` : result.length ? '' : 'В проверенных пространствах нет действий, ожидающих решения.') }
    })().catch(() => { if (!cancelled) setNotice('Не удалось прочитать очередь. Обновите список.') })
    return () => { cancelled = true }
  }, [authenticatedApi, limit, epoch])
  async function decide(row: Pending, approve: boolean) {
    if (busy) return
    setBusy(true)
    try {
      using workspace = await authenticatedApi.openGadget(row.workspace)
      if (approve) await workspace.approveAction(row.action.id)
      else await workspace.rejectAction(row.action.id)
      setEpoch(n => n + 1)
    } catch { setNotice('Результат не подтверждён. Обновите список: могли измениться права или состояние действия.') }
    finally { setBusy(false) }
  }
  // Карточки подтверждения в том же виде, что в беседе: янтарная рамка и пилюли решения.
  return <section className="overflow-auto p-3" aria-label="Действия агентов">
    <div className="mb-3 flex items-center gap-3">
      <h2 className="m-0 flex-1 text-[16px] leading-6 font-semibold text-kumo-default">Ждут моего разрешения</h2>
      <button type="button" className="h-8 cursor-pointer rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 text-[13px] text-kumo-default hover:bg-kumo-tint disabled:opacity-40" onClick={() => setEpoch(n => n + 1)} disabled={busy}>Обновить</button>
    </div>
    {notice && <p role="status" className="m-0 text-[14px] text-kumo-subtle">{notice}</p>}
    {rows.map(row => <article className="my-3 overflow-hidden rounded-[18px] border border-kumo-warning/35 bg-kumo-overlay" key={`${row.workspace}/${row.action.id}`}>
      <h3 className="m-0 border-b border-kumo-warning/15 px-[18px] py-3.5 text-[15px] leading-5 font-semibold text-kumo-default">{row.title}: {row.action.description.title}</h3>
      <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-words px-[18px] py-4 font-sans text-[15px] leading-6 text-kumo-default">{row.action.description.description}</pre>
      <div className="flex gap-2 border-t border-kumo-warning/15 px-[18px] py-3">
        <button type="button" className="h-[38px] cursor-pointer rounded-full bg-kumo-brand px-[18px] text-[14px] font-semibold text-white hover:bg-kumo-brand-hover disabled:opacity-40" disabled={busy} onClick={() => void decide(row, true)}>Разрешить</button>
        <button type="button" className="h-[38px] cursor-pointer rounded-full px-4 text-[14px] text-kumo-subtle hover:text-kumo-default disabled:opacity-40" disabled={busy} onClick={() => void decide(row, false)}>Отклонить</button>
      </div>
    </article>)}
    {total > limit && <button type="button" className="h-8 cursor-pointer rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 text-[13px] text-kumo-default hover:bg-kumo-tint" onClick={() => setLimit(n => n + 20)}>Проверить следующие пространства ({Math.min(limit,total)} из {total})</button>}
  </section>
}
