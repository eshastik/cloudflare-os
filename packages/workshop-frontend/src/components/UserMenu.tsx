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
            className="w-8 h-8 cursor-pointer rounded-full flex items-center justify-center bg-selection-bg hover:opacity-90 transition-opacity overflow-hidden"
            title="Открыть меню профиля"
            aria-label="Открыть меню профиля"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[13px] font-semibold text-selection-text">{initials}</span>
            )}
          </button>
        }
      />
      <DropdownMenu.Content className={MENU_CONTENT} style={MENU_POSITIONER_STYLE}>
        <DropdownMenu.Item
          onClick={() => navigate({ to: '/settings' })}
          className={MENU_ITEM}
        >
          Настройки
        </DropdownMenu.Item>
        <DropdownMenu.Item onClick={() => setAppearanceOpen(true)} className={MENU_ITEM}>Оформление</DropdownMenu.Item>
        {/* Служебное администратора платформы, которого нет в разделах приложения; то же есть на
            странице «Настройки». */}
        {isAdmin && (
          <>
            <DropdownMenu.Item onClick={() => navigate({ to: '/gatekeepers' })} className={MENU_ITEM}>
              Подключения сервисов
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onClick={() => navigate({ to: '/admin' })}
              className={MENU_ITEM}
            >
              Настройки платформы
            </DropdownMenu.Item>
          </>
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
