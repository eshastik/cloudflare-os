import { reportShellStage } from "./shellReadiness"
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi, AiChatAuthorInfo } from '@gadgets/workshop-shared/api'

interface AuthContextType {
  authenticatedApi: RpcStub<AuthenticatedApi>
  logout: () => void
  /** Current user info, fetched once on mount. Null while loading. */
  currentUser: AiChatAuthorInfo | null
  /** Whether the current user is a deployment admin. False while loading / for non-admins. */
  isAdmin: boolean
  /** Profile and admin lookup for this exact session; fallback UI is not a successful load. */
  initialization: "loading" | "ready" | "error"
}

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
  children: ReactNode
  authenticatedApi: RpcStub<AuthenticatedApi>
  onLogout: () => void
}

export function AuthProvider({ children, authenticatedApi, onLogout }: AuthProviderProps) {
  const [profile, setProfile] = useState<{ api: RpcStub<AuthenticatedApi>; value: AiChatAuthorInfo | null; failed: boolean } | null>(null)
  const [admin, setAdmin] = useState<{ api: RpcStub<AuthenticatedApi>; value: boolean; failed: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    authenticatedApi.whoami().then((value) => {
      if (!cancelled) setProfile({ api: authenticatedApi, value, failed: false })
    }).catch(() => {
      if (!cancelled) setProfile({ api: authenticatedApi, value: null, failed: true })
    })
    return () => { cancelled = true }
  }, [authenticatedApi])

  useEffect(() => {
    let cancelled = false
    authenticatedApi.amIAdmin().then((value) => {
      if (!cancelled) setAdmin({ api: authenticatedApi, value, failed: false })
    }).catch(() => {
      if (!cancelled) setAdmin({ api: authenticatedApi, value: false, failed: true })
    })
    return () => { cancelled = true }
  }, [authenticatedApi])

  // Derive from the current capability during render: an effect-based reset would expose the
  // previous user's identity/admin controls for one render after a session change.
  const currentProfile = profile?.api === authenticatedApi ? profile : null
  const currentAdmin = admin?.api === authenticatedApi ? admin : null
  const currentUser = currentProfile?.value ?? null
  const isAdmin = currentAdmin?.value ?? false
  const initialization = currentProfile?.failed || currentAdmin?.failed ? "error"
    : currentProfile && currentAdmin ? "ready" : "loading"

  useEffect(() => { reportShellStage("identity", initialization, authenticatedApi) }, [authenticatedApi, initialization])

  return (
    <AuthContext.Provider value={{ authenticatedApi, logout: onLogout, currentUser, isAdmin, initialization }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthenticatedApi() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuthenticatedApi must be used within an AuthProvider')
  }
  return context
}

/** Returns the auth context when inside an AuthProvider, or null on public pages. */
export function useOptionalAuthenticatedApi(): AuthContextType | null {
  return useContext(AuthContext)
}
