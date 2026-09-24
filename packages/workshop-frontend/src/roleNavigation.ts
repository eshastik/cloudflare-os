import type { GatekeeperAppInfo } from '@gadgets/workshop-shared/api'

// Левое меню по роли человека (ревизия интерфейса 24.09.2026). Роль выводится из разделов,
// которые приложение отдаёт по полномочиям (managementSections):
//   • всем — «Входящие», «Проекты» (раздела «Материалы» в меню нет: файлы живут в проектах,
//     найти любой — поиском ⌘K; редизайн 24.09.2026);
//   • руководителю — «Мой отдел» (team);
//   • администратору — пять разделов группы manage плоским списком: люди, правила, подключения,
//     агенты, журнал. Экран моделей открывается из «Настроек», отдельного пункта меню у него нет.
// Пункт показывается, только если раздел пришёл из приложения. Решения по согласованиям живут
// во «Входящих», отдельного пункта для них нет.

export type NavRole = 'employee' | 'manager' | 'admin'
export type NavIcon =
  | 'inbox' | 'projects' | 'team' | 'people' | 'rules' | 'connections' | 'agents' | 'journal'

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
  // Всем: Входящие, Проекты («Новая беседа», поиск и беседы меню рисует само).
  primary: NavLink[]
  // Руководителю: «Мой отдел».
  manager: NavLink[]
  // Администратору: ровно разделы из договора с приложением, плоским списком.
  management: NavLink[]
}

type Spec = { id: string; label: string; icon: NavIcon }

const PRIMARY: Spec[] = [
  { id: 'my-work', label: 'Входящие', icon: 'inbox' },
  { id: 'projects', label: 'Проекты', icon: 'projects' },
]
const MANAGER: Spec[] = [
  { id: 'team', label: 'Мой отдел', icon: 'team' },
]
const MANAGEMENT: Spec[] = [
  { id: 'people', label: 'Люди и отделы', icon: 'people' },
  { id: 'rules', label: 'Правила', icon: 'rules' },
  { id: 'connections', label: 'Подключения', icon: 'connections' },
  { id: 'agents', label: 'Агенты и расходы', icon: 'agents' },
  { id: 'journal', label: 'Журнал и состояние', icon: 'journal' },
]

type Section = NonNullable<GatekeeperAppInfo['sections']>[number]

// Раздел управления считается только с group:"manage": так сотрудник не увидит пункт «Управления»,
// даже если приложение отдаёт раздел с тем же id в повседневной группе.
const isManagement = (section: Section) => section.group === 'manage'

export function navigationRole(apps: GatekeeperAppInfo[]): NavRole {
  const sections = apps.flatMap(app => app.sections ?? [])
  if (sections.some(s => isManagement(s) && MANAGEMENT.some(spec => spec.id === s.id))) return 'admin'
  if (sections.some(s => s.id === 'team')) return 'manager'
  return 'employee'
}

export function buildRoleNavigation(apps: GatekeeperAppInfo[]): RoleNavigation {
  const role = navigationRole(apps)
  const pick = (specs: Spec[], prefix: string, accept: (section: Section) => boolean = () => true): NavLink[] =>
    apps.flatMap(app => {
      const multiple = apps.filter(other => other.id === app.id).length > 1
      return specs.flatMap(({ id, label, icon }) => {
        const section = (app.sections ?? []).find(item => item.id === id)
        if (!section || !accept(section)) return []
        return [{
          key: `${prefix}:${app.id}:${app.accountId}:${id}`,
          label: multiple ? `${label} — ${app.accountName || app.title}` : label,
          icon, count: section.count, appId: app.id, accountId: app.accountId, section: id,
          matchDefaultAccount: !multiple,
        }]
      })
    })

  const primary = pick(PRIMARY, 'primary')
  const manager = pick(MANAGER, 'manager')
  const management = pick(MANAGEMENT, 'manage', isManagement)
  return { role, primary, manager, management }
}
