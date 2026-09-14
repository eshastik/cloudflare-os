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
  return <section className="overflow-auto p-3" aria-label="Действия агентов">
    <h2>Ждут моего разрешения</h2>
    <button onClick={() => setEpoch(n => n + 1)} disabled={busy}>Обновить</button>
    {notice && <p role="status">{notice}</p>}
    {rows.map(row => <article className="my-3 rounded-lg border p-4" key={`${row.workspace}/${row.action.id}`}>
      <h3>{row.title}: {row.action.description.title}</h3>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{row.action.description.description}</pre>
      <button disabled={busy} onClick={() => void decide(row, false)}>Отклонить</button>{' '}
      <button disabled={busy} onClick={() => void decide(row, true)}>Разрешить</button>
    </article>)}
    {total > limit && <button onClick={() => setLimit(n => n + 20)}>Проверить следующие пространства ({Math.min(limit,total)} из {total})</button>}
  </section>
}
