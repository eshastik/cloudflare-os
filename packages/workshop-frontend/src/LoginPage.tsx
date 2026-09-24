import { useState, FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { RpcStub } from 'capnweb'
import { PublicApi } from '@gadgets/workshop-shared/api'
import { Hexagon } from '@phosphor-icons/react'
import { Button, Banner, Loader } from '@cloudflare/kumo'
import { hashPassword } from './passwordHash'
import { useServerConfig, useServerConfigError, useSiteName } from './ServerConfigContext'
import { useDocumentTitle } from './useDocumentTitle'
import { useConnectionLost } from './RpcContext'
import OAuthButtons from './components/auth/OAuthButtons'
import SiteLogo from './components/SiteLogo'


interface LoginPageProps {
  rpcStub: RpcStub<PublicApi>
  onLoginSuccess?: () => void
}

export default function LoginPage({ rpcStub, onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const serverConfig = useServerConfig()
  const serverConfigError = useServerConfigError()
  const siteName = useSiteName()
  const connectionLost = useConnectionLost()
  useDocumentTitle('Войти')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !password || loading) return
    setLoading(true)
    setError(null)

    try {
      const passwordHash = await hashPassword(username, password)
      const token = await rpcStub.login(username, passwordHash)
      if (token) {
        localStorage.setItem('authToken', token)
        if (onLoginSuccess) {
          onLoginSuccess()
        } else {
          window.location.reload()
        }
      } else {
        setError('Неверный логин или пароль')
      }
    } catch (err) {
      setError('Не удалось войти. Проверьте подключение и повторите попытку.')
    } finally {
      setLoading(false)
    }
  }

  // Until the deployment config loads we don't know which auth methods are enabled, so don't guess:
  // defaulting to the password form would show it even where it's disabled (and hide configured
  // OAuth providers). This is especially important when the server is unreachable — serverConfig
  // stays null — so render a loading / connection state instead of a misconfigured form.
  if (!serverConfig) {
    if (serverConfigError && !connectionLost) {
      return (
        <div
          role="alert"
          className="min-h-screen flex flex-col items-center justify-center gap-4 bg-kumo-base px-4"
        >
          <p className="text-sm text-kumo-danger text-center">
            Не удалось загрузить настройки платформы.
          </p>
          <Button variant="secondary" onClick={() => window.location.reload()}>Обновить</Button>
        </div>
      )
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-kumo-base px-4">
        <Loader size="lg" />
        <p className="text-sm text-kumo-subtle text-center">
          {connectionLost ? "Нет связи с сервером. Повторяем подключение…" : 'Загрузка…'}
        </p>
      </div>
    )
  }

  const authVendors = serverConfig.authVendors ?? []
  const passwordAuthEnabled = serverConfig.passwordAuthEnabled

  const field = 'h-[50px] w-full rounded-[14px] border border-kumo-fill-hover bg-kumo-overlay px-4 text-[15px] text-kumo-default placeholder:text-kumo-inactive outline-none transition-[border-color,box-shadow] focus:border-kumo-ring focus:ring-[3px] focus:ring-kumo-ring/15 disabled:opacity-60'

  // Макет Login: знак и заголовок по центру, сначала вход через внешние службы, под чертой «или» —
  // рабочая учётная запись с паролем.
  return (
    <div className="flex min-h-screen items-center justify-center bg-kumo-base px-4">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-[18px]">
        <SiteLogo size={44}>
          <Hexagon size={44} className="text-kumo-brand" />
        </SiteLogo>
        <h1 className="m-0 text-center text-[30px] leading-9 font-semibold tracking-[-0.8px] text-kumo-default">Вход в {siteName}</h1>
        <p className="m-0 mb-2 text-center text-[15px] text-kumo-subtle">Память вашей компании и агент, который с ней работает.</p>

        {authVendors.length > 0 && (
          <div className="w-full">
            {!passwordAuthEnabled && error && (
              <Banner variant="error" title={error} className="mb-4" />
            )}
            <OAuthButtons rpcStub={rpcStub} vendors={authVendors} onSuccess={onLoginSuccess} />
          </div>
        )}

        {passwordAuthEnabled && authVendors.length > 0 && (
          <div className="flex w-full items-center gap-3 text-[13px] text-kumo-inactive">
            <span className="h-px flex-1 bg-kumo-fill" />или<span className="h-px flex-1 bg-kumo-fill" />
          </div>
        )}

        {passwordAuthEnabled && (
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
            <label htmlFor="login-username" className="sr-only">Рабочая почта или логин</label>
            <input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              disabled={loading}
              placeholder="Рабочая почта или логин"
              className={field}
            />
            <label htmlFor="login-password" className="sr-only">Пароль</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              placeholder="Пароль"
              className={field}
            />

            {error && <Banner variant="error" title={error} />}

            <button
              type="submit"
              disabled={!username || !password || loading}
              className="flex h-[50px] w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-kumo-brand text-[15px] font-semibold text-white transition-colors hover:bg-kumo-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader size="sm" />}
              {loading ? 'Входим…' : 'Войти'}
            </button>
          </form>
        )}

        <p className="m-0 mt-1.5 text-center text-[13px] text-kumo-subtle">
          {passwordAuthEnabled && serverConfig.signupsEnabled ? (
            <>Нет учётной записи?{' '}<Link to="/signup" className="text-kumo-link hover:underline">Создать</Link></>
          ) : 'Нет доступа? Попросите руководителя прислать приглашение.'}
        </p>
      </div>
    </div>
  )
}
