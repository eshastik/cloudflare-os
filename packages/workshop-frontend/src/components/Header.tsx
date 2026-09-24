import { Link } from '@tanstack/react-router'
import { Hexagon, List, X } from '@phosphor-icons/react'
import { useOptionalAuthenticatedApi } from '../AuthContext'
import { useGatekeeperApps } from '../useGatekeeperApps'
import { useSiteName } from '../ServerConfigContext'
import { useState, useEffect, useRef } from 'react'
import UserMenu from './UserMenu'
import TopBarNotice from '../TopBarNotice'
import SiteLogo from './SiteLogo'

export default function Header() {
  const auth = useOptionalAuthenticatedApi()
  const gatekeeperApps = useGatekeeperApps()
  const siteName = useSiteName()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const headerRef = useRef<HTMLElement>(null)

  // Click-outside handler to close mobile menu
  useEffect(() => {
    if (!mobileMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mobileMenuOpen])

  const closeMobileMenu = () => setMobileMenuOpen(false)

  const navLinkClass = "text-[14px] px-3 py-1.5 rounded-[10px] transition-colors text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
  const navLinkActiveClass = "text-[14px] font-medium px-3 py-1.5 rounded-[10px] transition-colors text-kumo-default bg-kumo-fill"

  return (
    <header
      ref={headerRef}
      className="app-header sticky top-0 z-50 border-b border-kumo-fill bg-kumo-base"
    >
      <div className="relative px-4 sm:px-6 h-14 flex items-center justify-between">
        <TopBarNotice />
        {/* Logo */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <SiteLogo size={22} className="shrink-0">
              <Hexagon size={22} className="text-kumo-brand" />
            </SiteLogo>
            <span className="text-[17px] font-bold tracking-[-0.3px] text-kumo-default">
              {siteName}
            </span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden sm:flex items-center gap-1">
            <Link
              to="/"
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
              activeOptions={{ exact: true }}
            >
              Новая беседа
            </Link>
            <Link
              to="/gatekeepers"
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
              activeOptions={{ exact: true }}
            >
              Подключения
            </Link>
            <Link
              to="/explore"
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
            >
              Шаблоны
            </Link>
            {gatekeeperApps.map((app) => (
              <Link
                key={app.id}
                to="/gatekeepers/$appId"
                params={{ appId: app.id }}
                className={navLinkClass}
                activeProps={{ className: navLinkActiveClass }}
              >
                {app.title}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Desktop avatar dropdown */}
          {auth && (
            <div className="hidden sm:block">
              <UserMenu />
            </div>
          )}

          {/* Mobile hamburger button */}
          <div className="sm:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
              className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-kumo-tint transition-colors text-kumo-default"
            >
              {mobileMenuOpen ? <X size={20} /> : <List size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-t border-kumo-fill bg-kumo-base">
          <nav className="flex flex-col px-4 py-3 gap-1">
            <Link
              to="/"
              onClick={closeMobileMenu}
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
              activeOptions={{ exact: true }}
            >
              Новая беседа
            </Link>
            <Link
              to="/gatekeepers"
              onClick={closeMobileMenu}
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
              activeOptions={{ exact: true }}
            >
              Подключения
            </Link>
            <Link
              to="/explore"
              onClick={closeMobileMenu}
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
            >
              Шаблоны
            </Link>
            {gatekeeperApps.map((app) => (
              <Link
                key={app.id}
                to="/gatekeepers/$appId"
                params={{ appId: app.id }}
                onClick={closeMobileMenu}
                className={navLinkClass}
                activeProps={{ className: navLinkActiveClass }}
              >
                {app.title}
              </Link>
            ))}

            {auth && (
              <>
                <hr className="my-2 border-kumo-fill" />

                <Link
                  to="/settings"
                  onClick={closeMobileMenu}
                  className={navLinkClass}
                  activeProps={{ className: navLinkActiveClass }}
                >
                  Настройки
                </Link>
                <Link
                  to="/providers"
                  onClick={closeMobileMenu}
                  className={navLinkClass}
                  activeProps={{ className: navLinkActiveClass }}
                >
                  Модели
                </Link>
                {auth.isAdmin && (
                  <Link
                    to="/admin"
                    onClick={closeMobileMenu}
                    className={navLinkClass}
                    activeProps={{ className: navLinkActiveClass }}
                  >
                    Настройки платформы
                  </Link>
                )}
                <button
                  onClick={() => { closeMobileMenu(); auth.logout() }}
                  className="text-left text-sm px-3 py-1.5 rounded-md text-kumo-danger hover:bg-kumo-tint transition-colors"
                >
                  Выйти
                </button>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
