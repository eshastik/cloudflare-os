import type { GatekeeperAppInfo } from '@gadgets/workshop-shared/api'

// Левое меню по роли человека (решение владельца 23.09: «Больше прав — больше видно, но не
// раньше»). Роль выводится из разделов, которые приложение уже отдаёт по полномочиям:
//   • «Люди и доступ» (people) приходит только при principal.manage,
//   • «Организация» (organization) — при principal.manage или platform.metrics.read,
//   • администратор платформы — по amIAdmin() оболочки.
// Руководитель: отдельного полномочия у сервера нет (нет project.maintain и признака руководителя
// отдела). Пока оболочка узнаёт его по разделу «Моя команда» (team), если приложение начнёт его
// отдавать, или по числу решений в «Согласованиях» (approvals.count > 0). Недоступное не
// показывается вовсе, а не делается неактивным.

export type NavRole = 'employee' | 'manager' | 'admin'
export type NavIcon =
  | 'inbox' | 'projects' | 'documents' | 'approvals' | 'team' | 'people' | 'data' | 'agents'
  | 'organization' | 'sources' | 'templates' | 'analytics' | 'platform'

export type NavLink = {
  key: string
  label: string
  icon: NavIcon
  count?: number
  // Раздел приложения (/gatekeepers/$appId?section=…) или страница оболочки (to).
  appId?: string
  accountId?: number
  section?: string
  matchDefaultAccount?: boolean
  to?: string
}

export type RoleNavigation = {
  role: NavRole
  // Сотруднику и всем: Входящие, Проекты, Материалы («Новая беседа» и «Беседы» рисует меню само).
  primary: NavLink[]
  // Руководителю: согласования и своя команда.
  manager: NavLink[]
  // Администратору: пункт «Управление».
  management: NavLink[]
  // Свёрнуто под «Тонкие настройки» внутри «Управления».
  fine: NavLink[]
}

type Spec = { id: string; label: string; icon: NavIcon }

const PRIMARY: Spec[] = [
  { id: 'my-work', label: 'Входящие', icon: 'inbox' },
  { id: 'projects', label: 'Проекты', icon: 'projects' },
  { id: 'documents', label: 'Материалы', icon: 'documents' },
]
const MANAGER: Spec[] = [
  { id: 'approvals', label: 'Ждёт моего решения', icon: 'approvals' },
  { id: 'team', label: 'Мой отдел и проекты', icon: 'team' },
]
// «Журнал», «Состояние» и правила видимости проектов живут в одном разделе «Организация».
const MANAGEMENT: Spec[] = [
  { id: 'people', label: 'Люди и доступ', icon: 'people' },
  { id: 'organization', label: 'Проекты, журнал и состояние', icon: 'organization' },
  { id: 'intake', label: 'Данные', icon: 'data' },
  { id: 'agents', label: 'Агенты и лимиты', icon: 'agents' },
]
const FINE: Spec[] = [
  { id: 'sources', label: 'Источники', icon: 'sources' },
  { id: 'approvals', label: 'Согласования', icon: 'approvals' },
  { id: 'templates', label: 'Рабочие шаблоны', icon: 'templates' },
  { id: 'analytics', label: 'Обзор работы', icon: 'analytics' },
]

const ADMIN_SECTIONS = new Set(['people', 'organization'])

export function navigationRole(apps: GatekeeperAppInfo[], isPlatformAdmin: boolean): NavRole {
  const sections = apps.flatMap(app => app.sections ?? [])
  if (isPlatformAdmin || sections.some(s => ADMIN_SECTIONS.has(s.id))) return 'admin'
  if (sections.some(s => s.id === 'team' || (s.id === 'approvals' && (s.count ?? 0) > 0))) return 'manager'
  return 'employee'
}

export function buildRoleNavigation(apps: GatekeeperAppInfo[], isPlatformAdmin: boolean): RoleNavigation {
  const role = navigationRole(apps, isPlatformAdmin)
  const pick = (specs: Spec[], prefix: string): NavLink[] => apps.flatMap(app => {
    const multiple = apps.filter(other => other.id === app.id).length > 1
    return specs.flatMap(({ id, label, icon }) => {
      const section = (app.sections ?? []).find(item => item.id === id)
      if (!section) return []
      return [{
        key: `${prefix}:${app.id}:${app.accountId}:${id}`,
        label: multiple ? `${label} — ${app.accountName || app.title}` : label,
        icon, count: section.count, appId: app.id, accountId: app.accountId, section: id,
        matchDefaultAccount: !multiple,
      }]
    })
  })

  const primary = pick(PRIMARY, 'primary')
  const manager = role === 'employee' ? [] : pick(MANAGER, 'manager')
  const management = role === 'admin' ? pick(MANAGEMENT, 'manage') : []
  const managerSections = new Set(manager.map(link => link.section))
  const fine = role === 'admin'
    ? pick(FINE, 'fine').filter(link => !managerSections.has(link.section))
    : []
  if (role === 'admin' && isPlatformAdmin) {
    fine.push({ key: 'fine:platform', label: 'Настройки платформы', icon: 'platform', to: '/admin' })
  }
  return { role, primary, manager, management, fine }
}
