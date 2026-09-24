import { useState, type ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { useAuthenticatedApi } from './AuthContext'
import { useGatekeeperApps } from './useGatekeeperApps'
import AppearanceSettings from './components/AppearanceSettings'
import { useDocumentTitle } from './useDocumentTitle'

// Sections that live in the rail; everything else an app offers is a service section and is
// reachable from here instead of crowding the navigation.
const PRIMARY = new Set(['my-work', 'projects', 'documents'])
// Rarely used sections go under "Дополнительно" rather than next to organisation settings.
const EXTRA = new Set(['templates', 'analytics'])

const NOTES: Record<string, string> = {
  approvals: 'Решения по изменениям в вашей предметной области.',
  agents: 'Помощники команды, их задачи и разрешения.',
  sources: 'Почта, CRM, диски и другие рабочие системы.',
  people: 'Сотрудники и их права по проектам и областям знаний.',
  intake: 'Загрузка материалов организации и проверка их распределения.',
  organization: 'Правила работы, состояние системы и журнал действий.',
  templates: 'Повторяющиеся задачи и документы команды.',
  analytics: 'Состояние проектов, расходы и качество результатов.',
}

type Row = { key: string; title: string; note?: string; link?: LinkProps; onClick?: () => void }

export default function SettingsHub() {
  useDocumentTitle('Настройки')
  const { isAdmin } = useAuthenticatedApi()
  const apps = useGatekeeperApps()
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  const personal: Row[] = [
    { key: 'profile', title: 'Профиль', note: 'Имя, почта и пароль.', link: { to: '/profile' } },
    { key: 'appearance', title: 'Оформление', note: 'Тема и цвет акцента.', onClick: () => setAppearanceOpen(true) },
    { key: 'providers', title: 'Модели', note: 'Подключённые модели и ключи доступа.', link: { to: '/providers' } },
  ]

  const organization: Row[] = []
  const extra: Row[] = []
  for (const app of apps) {
    const suffix = apps.filter(other => other.id === app.id).length > 1 ? ` — ${app.accountName || app.title}` : ''
    const at = (search: Record<string, unknown>): LinkProps =>
      ({ to: '/gatekeepers/$appId', params: { appId: app.id }, search: { account: app.accountId, ...search } }) as unknown as LinkProps
    for (const section of app.sections ?? []) {
      if (PRIMARY.has(section.id)) continue
      const row = { key: `${app.id}:${app.accountId}:${section.id}`, title: section.title + suffix, note: NOTES[section.id], link: at({ section: section.id }) }
      ;(EXTRA.has(section.id) ? extra : organization).push(row)
    }
    if (app.sections?.length) {
      organization.push({ key: `${app.id}:${app.accountId}:connections`, title: 'Почта, календари и файлы' + suffix, note: 'Подключения для работы команды.', link: at({ section: 'sources', tool: 'connections' }) })
      organization.push({ key: `${app.id}:${app.accountId}:summary`, title: 'Свод организаций' + suffix, note: 'Общая картина по вашим организациям.', link: at({ section: 'organization', tool: 'summary' }) })
    }
  }
  extra.push(
    { key: 'outputs', title: 'Результаты бесед', note: 'Документы и файлы, созданные в беседах.', link: { to: '/outputs' } },
    { key: 'blueprints', title: 'Сохранённые приложения', link: { to: '/blueprints' } },
    { key: 'explore', title: 'Каталог приложений', link: { to: '/explore' } },
    { key: 'gatekeepers', title: 'Подключения сервисов', note: 'Сервисы, к которым обращаются агенты.', link: { to: '/gatekeepers' } },
  )
  if (isAdmin) extra.push({ key: 'admin', title: 'Настройки платформы', link: { to: '/admin' } })

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-6">
        <h1 className="m-0 text-[24px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default">Настройки</h1>
        <p className="mt-1 mb-0 max-w-[650px] text-[14px] leading-5 text-kumo-subtle">Личные настройки и служебные разделы организации.</p>
      </header>
      <Group title="Личное" rows={personal} />
      {organization.length > 0 && <Group title="Организация" rows={organization} />}
      <Group title="Дополнительно" rows={extra} />
      {appearanceOpen && <AppearanceSettings open={appearanceOpen} onOpenChange={setAppearanceOpen} />}
    </div>
  )
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section aria-label={title} className="mb-6 max-w-[768px]">
      <h2 className="mt-0 mb-2 text-[15px] font-semibold text-kumo-strong">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
        {rows.map(row => <RowItem key={row.key} row={row} />)}
      </div>
    </section>
  )
}

function RowItem({ row }: { row: Row }) {
  const body: ReactNode = (
    <>
      <span className="block text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-kumo-default">{row.title}</span>
      {row.note && <span className="mt-0.5 block text-[12px] leading-4 text-kumo-subtle">{row.note}</span>}
    </>
  )
  const className = 'block w-full border-t border-kumo-line p-3 text-left first:border-t-0 hover:bg-kumo-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring'
  if (row.link) return <Link {...row.link} className={className}>{body}</Link>
  return <button type="button" onClick={row.onClick} className={`${className} cursor-pointer`}>{body}</button>
}
