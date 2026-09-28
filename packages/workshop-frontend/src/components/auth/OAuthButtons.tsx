import { useEffect, useState } from 'react'
import { AuthVendorInfo } from '@gadgets/workshop-shared/api'
import { Button, Banner } from '@cloudflare/kumo'
import { loginReturnError, startGatekeeperLogin } from '../../auth/loginReturn'

interface OAuthButtonsProps {
  vendors: AuthVendorInfo[]
  /** Основной способ входа: одна крупная кнопка вместо «Войти через …». */
  primary?: { vendorId: string; label: string }
}

// Кнопка входа на каждый гейткипер, умеющий вход. Нажатие уводит эту же страницу к гейткиперу;
// после входа он возвращает её сюда с одноразовым кодом (auth/loginReturn.ts). Всплывающих окон
// нет: на телефоне их не бывает, а фоновая вкладка теряет соединение.
export default function OAuthButtons({ vendors, primary }: OAuthButtonsProps) {
  const [error] = useState<string | null>(() => loginReturnError())
  const [pending, setPending] = useState<string | null>(null)

  // «Назад» из гейткипера в Safari показывает страницу из кэша вместе с «Переходим ко входу…»:
  // кнопку надо оживить.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setPending(null) }
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [])

  if (vendors.length === 0) return null

  const start = (vendorId: string) => {
    setPending(vendorId)
    startGatekeeperLogin(vendorId)
  }

  return (
    <div className="space-y-3">
      {error && <Banner variant="error" title={error} />}
      {vendors.map((vendor) => vendor.vendorId === primary?.vendorId ? (
        <button
          key={vendor.vendorId}
          type="button"
          onClick={() => start(vendor.vendorId)}
          disabled={pending !== null}
          className="flex h-[50px] w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] border-0 bg-kumo-brand text-[15px] font-semibold text-white transition-colors hover:bg-kumo-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending === vendor.vendorId ? 'Переходим ко входу…' : primary.label}
        </button>
      ) : (
        <Button
          key={vendor.vendorId}
          variant="secondary"
          onClick={() => start(vendor.vendorId)}
          loading={pending === vendor.vendorId}
          disabled={pending !== null}
          className="w-full justify-center"
        >
          {vendor.logo && (
            <img
              src={vendor.logo.url}
              alt=""
              className="mr-1"
              style={{ height: 18, width: 'auto' }}
            />
          )}
          Войти через {vendor.displayName}
        </Button>
      ))}
    </div>
  )
}
