import { useEffect, useRef } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useKumoToastManager } from '@cloudflare/kumo'
import { claimConnectReturnNotice, completeConnectReturn, connectReturnMessage } from './accountConnect'

/** После возврата из подключения аккаунта меняет код в сеансе и показывает итог — один раз. */
export default function ConnectReturnNotice({ api }: { api: RpcStub<AuthenticatedApi> }) {
  const toasts = useKumoToastManager()
  // Менеджер уведомлений новый на каждый рендер: в зависимостях эффекта он показывал бы итог снова.
  const toastsRef = useRef(toasts)
  toastsRef.current = toasts
  useEffect(() => {
    let cancelled = false
    completeConnectReturn(api).then(outcome => {
      if (cancelled || !outcome || !claimConnectReturnNotice()) return
      toastsRef.current.add({ title: connectReturnMessage(outcome), variant: outcome.ok ? 'success' : 'error' })
    })
    return () => { cancelled = true }
  }, [api])
  return null
}
