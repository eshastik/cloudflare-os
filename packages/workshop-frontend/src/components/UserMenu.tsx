import { useState } from "react"
import AppearanceSettings from "./AppearanceSettings"
import { useNavigate } from '@tanstack/react-router'
import { DropdownMenu } from '@cloudflare/kumo'
import { useAuthenticatedApi } from '../AuthContext'
import { useAvatar } from '../useAvatar'
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_POSITIONER_STYLE } from './menuStyles'

export default function UserMenu() {
  const { authenticatedApi, logout, currentUser, isAdmin } = useAuthenticatedApi()
  const navigate = useNavigate()
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  const avatarUrl = useAvatar(authenticatedApi, currentUser?.id)

  const initials = currentUser?.name
    ? currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  return (
    <>
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <button
            className="w-7 h-7 cursor-pointer rounded-full flex items-center justify-center bg-kumo-tint hover:bg-kumo-fill transition-colors overflow-hidden"
            title="Открыть меню профиля"
            aria-label="Открыть меню профиля"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-medium text-kumo-strong">{initials}</span>
            )}
          </button>
        }
      />
      <DropdownMenu.Content className={MENU_CONTENT} style={MENU_POSITIONER_STYLE}>
        <DropdownMenu.Item
          onClick={() => navigate({ to: '/profile' })}
          className={MENU_ITEM}
        >
          Профиль
        </DropdownMenu.Item>
        <DropdownMenu.Item onClick={() => setAppearanceOpen(true)} className={MENU_ITEM}>Оформление</DropdownMenu.Item>
        <DropdownMenu.Item
          onClick={() => navigate({ to: '/providers' })}
          className={MENU_ITEM}
        >
          Подключения моделей
        </DropdownMenu.Item>
        {isAdmin && (
          <DropdownMenu.Item
            onClick={() => navigate({ to: '/admin' })}
            className={MENU_ITEM}
          >
            Настройки платформы
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          variant="danger"
          onClick={logout}
          className={MENU_ITEM_DANGER}
        >
          Выйти
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
    {appearanceOpen && <AppearanceSettings open={appearanceOpen} onOpenChange={setAppearanceOpen} />}
    </>
  )
}
