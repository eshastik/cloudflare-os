import { bindShellReadiness, routeShellReadiness, skipShellReadiness, reportShellStage } from "../shellReadiness"
import { observeWorkspaceActivity } from "../workspaceActivity"
import { logRpcFailure } from '../rpcErrors'
import { useState, useEffect } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { TooltipProvider, Toasty } from '@cloudflare/kumo'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useRpcStub, useConnectionLost } from '../RpcContext'
import { markConnectionRestored } from '../main'
import { useAuth, CF_ACCESS_MODE } from '../useAuth'
import { AuthProvider } from '../AuthContext'
import { FeatureFlagsProvider } from '../FeatureFlagsContext'
import Header from '../components/Header'
import AppShell from '../components/AppShell/AppShell'
import LoginPage from '../LoginPage'
import OnboardingWizard from '../OnboardingWizard'
import AccountSelectionModal from '../components/billing/AccountSelectionModal'
import UploadDock from '../UploadDock'

export const Route = createRootRoute({
  component: RootComponent,
})

function ConnectionLostBanner() {
  return (
    <div className="sticky top-0 z-[100] bg-kumo-warning-tint border-b border-kumo-warning/30 px-4 py-2 text-center text-sm text-kumo-warning">
      Связь потеряна, переподключаемся…
    </div>
  )
}

function RootComponent() {
  const rpcStub = useRpcStub()
  const connectionLost = useConnectionLost()
  const { isAuthenticated, authenticatedApi, isLoading, error, logout, login } = useAuth(rpcStub)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (authenticatedApi) return observeWorkspaceActivity(authenticatedApi);
  }, [authenticatedApi])

  // When authenticatedApi becomes available, the connection is proven alive.
  useEffect(() => {
    if (authenticatedApi) markConnectionRestored()
  }, [authenticatedApi])

  // Routes that don't require auth (public routes)
  const isSignup = pathname === '/signup'
  const isBlueprint = pathname.startsWith('/blueprint/')

  // A standalone (no app shell) render is used only for signed-out visitors of public routes.
  // Signed-in users get the full app chrome so public pages (esp. the blueprint detail) feel
  // native — sidebar and all — instead of floating on a bare page.
  const standalone = isSignup || (isBlueprint && !isAuthenticated)

  useEffect(() => {
    routeShellReadiness(pathname)
    if (standalone || (!isLoading && !isAuthenticated && !CF_ACCESS_MODE)) skipShellReadiness()
    if (authenticatedApi) bindShellReadiness(authenticatedApi)
  }, [pathname, standalone, isLoading, isAuthenticated, authenticatedApi])

  // The workspace editor renders fullscreen (no app chrome). /gadget/ is the legacy URL, kept
  // here so the chrome doesn't flash in during the redirect to /workspace/.
  const isWorkspaceEditor = pathname.startsWith('/workspace/') || pathname.startsWith('/gadget/')

  const handleLoginSuccess = () => {
    const token = localStorage.getItem('authToken')
    if (token) {
      login(token)
    }
  }

  // Loading state
  if (isLoading && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base">
        {connectionLost && <ConnectionLostBanner />}
        <div className="w-8 h-8 border-2 border-kumo-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-kumo-subtle">{connectionLost ? 'Ждём сервер…' : 'Загрузка…'}</p>
      </div>
    )
  }

  // Auth error
  if (error && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base p-6">
        <p className="text-sm text-kumo-danger">Ошибка входа: {error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-medium text-kumo-inverse bg-kumo-brand rounded-lg hover:bg-kumo-brand-hover transition-colors"
        >
          Повторить
        </button>
      </div>
    )
  }

  // CF Access mode: show spinner while pipelined auth resolves
  if (!isAuthenticated && CF_ACCESS_MODE && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base">
        <div className="w-8 h-8 border-2 border-kumo-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-kumo-subtle">Выполняется вход…</p>
      </div>
    )
  }

  // Not authenticated and not a public route — show login
  if (!isAuthenticated && !standalone) {
    return <LoginPage rpcStub={rpcStub} onLoginSuccess={handleLoginSuccess} />
  }

  // Signed-out visitors of public routes render without the auth wrapper / app shell.
  if (standalone) {
    const showHeader = !isSignup
    return (
      <TooltipProvider>
        <Toasty>
          {showHeader && <Header />}
          <Outlet />
        </Toasty>
      </TooltipProvider>
    )
  }

  // Authenticated — render the full shell (with onboarding gate)
  // authenticatedApi is guaranteed non-null here: isLoading, error, and
  // !isAuthenticated branches all return early above.
  if (!authenticatedApi) return null
  return (
    <AuthProvider authenticatedApi={authenticatedApi} onLogout={logout}>
      <FeatureFlagsProvider>
        <TooltipProvider>
          <Toasty>
            <AuthenticatedShell
              authenticatedApi={authenticatedApi}
              connectionLost={connectionLost}
              isWorkspaceEditor={isWorkspaceEditor}
            />
          </Toasty>
        </TooltipProvider>
      </FeatureFlagsProvider>
    </AuthProvider>
  )
}

/**
 * Inner shell that checks onboarding status and either shows the wizard
 * or the normal app chrome. Lives inside AuthProvider so the wizard can
 * use useAuthenticatedApi().
 */
function AuthenticatedShell({
  authenticatedApi,
  connectionLost,
  isWorkspaceEditor,
}: {
  authenticatedApi: RpcStub<AuthenticatedApi>
  connectionLost: boolean
  isWorkspaceEditor: boolean
}) {
  // null = still checking, true = needs onboarding, false = onboarding done
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean | null>(null)
  const [onboardingResult, setOnboardingResult] = useState<{api: object; state: "ready" | "error" | "interactive"} | null>(null)

  useEffect(() => {
    let cancelled = false
    authenticatedApi.isOnboardingCompleted().then((completed) => {
      if (!cancelled) {
        setOnboardingNeeded(!completed)
        setOnboardingResult({api: authenticatedApi, state: completed ? "ready" : "interactive"})
      }
    }).catch((err) => {
      logRpcFailure('Failed to check onboarding status:', err)
      // If the check fails, skip onboarding to avoid blocking the user
      if (!cancelled) { setOnboardingNeeded(false); setOnboardingResult({api: authenticatedApi, state: "error"}) }
    })
    return () => { cancelled = true }
  }, [authenticatedApi])

  useEffect(() => {
    const state = onboardingResult?.api === authenticatedApi ? onboardingResult.state : "loading"
    if (state === "interactive") skipShellReadiness()
    else reportShellStage("onboarding", state, authenticatedApi)
  }, [authenticatedApi, onboardingResult])

  // Still checking onboarding status
  if (onboardingNeeded === null) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base">
        <div className="w-8 h-8 border-2 border-kumo-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Show onboarding wizard
  if (onboardingNeeded) {
    return <OnboardingWizard onComplete={() => setOnboardingNeeded(false)} />
  }

  // One chrome everywhere: the conversation editor keeps the left rail too, it only brings its own
  // header instead of the shell's top strip.
  return (
    <>
      {connectionLost && <ConnectionLostBanner />}
      <AccountSelectionModal />
      <AppShell bare={isWorkspaceEditor}>
        <Outlet />
      </AppShell>
      {/* Загрузка файлов живёт вне страниц и видна в любом разделе. */}
      <UploadDock />
    </>
  )
}
