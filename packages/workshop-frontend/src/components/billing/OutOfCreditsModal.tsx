import { useCallback, useEffect, useState } from 'react'
import { CloudflareUsageInfo, CloudflareAccountOption } from '@gadgets/workshop-shared/api'
import { Dialog, Button, Loader, useKumoToastManager } from '@cloudflare/kumo'
import { CloudWarning, Lightning } from '@phosphor-icons/react'
import { useOptionalAuthenticatedApi } from '../../AuthContext'
import { buildAddCreditsUrl } from './creditsUrl'
import ResetCountdown from './ResetCountdown'

interface OutOfCreditsModalProps {
  open: boolean
  onClose: () => void
}

// Modal shown when a user has exhausted their free daily allowance. Guides them to connect their
// Cloudflare account (if not connected), pick which account to bill (if they have several), or top
// up credits in the Cloudflare dashboard (if connected but low balance).
export default function OutOfCreditsModal({ open, onClose }: OutOfCreditsModalProps) {
  const auth = useOptionalAuthenticatedApi()
  const toasts = useKumoToastManager()
  const [usage, setUsage] = useState<CloudflareUsageInfo | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [accounts, setAccounts] = useState<CloudflareAccountOption[] | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!auth) return
    auth.authenticatedApi.getCloudflareUsage()
      .then((u: CloudflareUsageInfo) => setUsage(u))
      .catch(() => {})
  }, [auth])

  useEffect(() => {
    if (!open || !auth) return
    setUsage(null)
    setAccounts(null)
    refresh()
    // Re-check when the tab regains focus, so returning from the "Connect Cloudflare" OAuth pop-up
    // updates the modal (connected state / balance / account list) without reopening it.
    const onFocus = () => {
      setAccounts(null)
      refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [open, auth, refresh])

  // Load the account list when the server says the user must pick one.
  useEffect(() => {
    if (!auth) return
    if (usage?.connected && usage.needsAccountSelection && accounts === null) {
      auth.authenticatedApi.listCloudflareAccounts()
        .then((list: CloudflareAccountOption[]) => setAccounts(list))
        .catch(() => setAccounts([]))
    }
  }, [auth, usage, accounts])

  const connect = async () => {
    if (!auth) return
    setConnecting(true)
    try {
      const { url } = await auth.authenticatedApi.connectAccount('cloudflare')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      // ignore
    } finally {
      setConnecting(false)
    }
  }

  const selectAccount = async (accountId: string) => {
    if (!auth) return
    setSelecting(accountId)
    try {
      await auth.authenticatedApi.selectCloudflareAccount(accountId)
      setAccounts(null)
      refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось выбрать аккаунт'
      toasts.add({ title: msg, variant: 'error' })
    } finally {
      setSelecting(null)
    }
  }

  const connected = usage?.connected ?? false
  const needsSelection = connected && (usage?.needsAccountSelection ?? false)

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog className="p-6 sm:w-[560px]" size="base">
        <Dialog.Title className="text-lg font-semibold mb-2 flex items-center gap-2">
          <CloudWarning size={22} weight="bold" className="text-kumo-warning" />
          Бесплатный лимит на сегодня исчерпан
        </Dialog.Title>

        {usage === null ? (
          <div className="flex justify-center py-8"><Loader size="base" /></div>
        ) : (
          <div className="space-y-4">
            {!connected ? (
              <p className="text-sm text-kumo-subtle">
                Бесплатные запросы на сегодня закончились (лимит: {usage.dailyLimit}). Подключите
                аккаунт Cloudflare, чтобы продолжить сейчас: запросы сверх лимита оплачиваются с вашего
                баланса Cloudflare AI Gateway
                {usage.resetAt ? (
                  <>
                    {' '}— или подождите: лимит обновится в 00:00 UTC, через{' '}
                    <ResetCountdown resetAt={usage.resetAt} onElapsed={refresh} />.
                  </>
                ) : '.'}
              </p>
            ) : needsSelection ? (
              <p className="text-sm text-kumo-subtle">
                Подключению Cloudflare доступно несколько аккаунтов. Выберите, с баланса какого
                AI Gateway оплачивать запросы сверх бесплатного лимита.
              </p>
            ) : (
              <p className="text-sm text-kumo-subtle">
                Аккаунт Cloudflare подключён
                {usage.balance !== null && (
                  <>, баланс <strong>${usage.balance.toFixed(2)}</strong></>
                )}
                , но этого не хватает, чтобы продолжить. Пополните баланс AI Gateway, чтобы продолжить
                сейчас
                {usage.resetAt ? (
                  <>
                    {' '}или подождите: бесплатный лимит обновится в 00:00 UTC, через{' '}
                    <ResetCountdown resetAt={usage.resetAt} onElapsed={refresh} />.
                  </>
                ) : '.'}
              </p>
            )}

            {needsSelection && (
              <div className="flex flex-col gap-2">
                {accounts === null ? (
                  <p className="text-sm text-kumo-subtle">Загрузка аккаунтов…</p>
                ) : accounts.length === 0 ? (
                  <p className="text-sm text-kumo-subtle">В этом подключении нет доступных аккаунтов.</p>
                ) : (
                  accounts.map((a) => (
                    <Button
                      key={a.accountId}
                      variant="secondary"
                      className="justify-start"
                      onClick={() => selectAccount(a.accountId)}
                      loading={selecting === a.accountId}
                      disabled={selecting !== null}
                    >
                      {a.accountName}
                    </Button>
                  ))
                )}
              </div>
            )}

            <p className="text-sm text-kumo-subtle">
              Подробнее —{' '}
              <a
                href="https://developers.cloudflare.com/ai-gateway/features/unified-billing/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                единая оплата AI Gateway
              </a>
              .
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              {!connected ? (
                <>
                  <Button variant="secondary" onClick={onClose}>Позже</Button>
                  <Button variant="primary" onClick={connect} loading={connecting}>
                    <Lightning size={16} weight="bold" />
                    Подключить Cloudflare
                  </Button>
                </>
              ) : needsSelection ? (
                <Button variant="secondary" onClick={onClose}>Закрыть</Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={onClose}>Закрыть</Button>
                  <Button
                    variant="primary"
                    onClick={() => window.open(buildAddCreditsUrl(usage.accountId), '_blank')}
                  >
                    Пополнить баланс в Cloudflare
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </Dialog.Root>
  )
}
