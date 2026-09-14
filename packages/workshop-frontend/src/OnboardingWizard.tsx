import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Input, Banner } from '@cloudflare/kumo'
import { Camera, Hexagon } from '@phosphor-icons/react'
import { useAuthenticatedApi } from './AuthContext'
import { compressAvatar, avatarBlobUrl } from './avatarUtils'
import { invalidateAvatarCache } from './useAvatar'
import { useSiteName } from './ServerConfigContext'
import SiteLogo from './components/SiteLogo'
import { useDocumentTitle } from './useDocumentTitle'

/** Первый вход не требует выбора модели, проекта или подключения сервисов. */
export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const { authenticatedApi, currentUser } = useAuthenticatedApi()
  const siteName = useSiteName()
  useDocumentTitle('Начало работы')
  const [displayName, setDisplayName] = useState(currentUser?.name ?? '')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarData, setAvatarData] = useState<Uint8Array | null>(null)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { setDisplayName(currentUser?.name ?? '') }, [currentUser?.id, currentUser?.name])
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview) }, [avatarPreview])

  async function chooseAvatar(file: File) {
    if (!file.type.startsWith('image/')) { setError('Выберите изображение для фотографии.'); return }
    setProcessing(true)
    setError(null)
    try {
      const data = await compressAvatar(file)
      if (mounted.current) { setAvatarData(data); setAvatarPreview(avatarBlobUrl(data)) }
    } catch { if (mounted.current) setError('Не удалось обработать фотографию. Попробуйте другое изображение.') }
    finally { if (mounted.current) setProcessing(false) }
  }

  async function finish(event: FormEvent) {
    event.preventDefault()
    const name = displayName.trim()
    if (!name || processing || saving) return
    setSaving(true)
    setError(null)
    try {
      if (name !== currentUser?.name) await authenticatedApi.setOwnDisplayName(name)
      if (avatarData) {
        await authenticatedApi.setAvatar(avatarData)
        if (currentUser?.id) invalidateAvatarCache(currentUser.id)
      }
      await authenticatedApi.completeOnboarding()
      if (mounted.current) onComplete()
    } catch {
      if (mounted.current) { setError('Не удалось сохранить профиль. Повторите попытку.'); setSaving(false) }
    }
  }

  return <main className="min-h-screen bg-kumo-base dotted-bg flex items-center justify-center px-4 py-10">
    <div className="w-full max-w-md">
      <div className="mb-8 flex items-center justify-center gap-2 text-kumo-default">
        <SiteLogo size={26}><Hexagon size={26} weight="bold" className="text-kumo-brand" /></SiteLogo>
        <span className="text-lg font-semibold">{siteName}</span>
      </div>
      <form onSubmit={finish} className="rounded-2xl border border-kumo-line bg-kumo-base p-7 shadow-sm">
        <h1 className="text-2xl font-semibold text-kumo-default">Начнём работу</h1>
        <p className="mt-2 text-sm leading-6 text-kumo-subtle">Опишите задачу в чате. {siteName} поможет найти доступные материалы и подготовить результат.</p>
        <div className="my-7 flex items-center gap-4">
          <button type="button" aria-label="Выбрать фотографию" disabled={processing || saving}
            onClick={() => fileInput.current?.click()}
            onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !processing && !saving) void chooseAvatar(file) }}
            className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-kumo-line bg-kumo-tint text-kumo-subtle hover:border-kumo-brand disabled:opacity-50">
            {avatarPreview ? <img src={avatarPreview} alt="Фотография профиля" className="size-full object-cover" /> : <Camera size={24} />}
          </button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseAvatar(file) }} />
          <div className="min-w-0 flex-1"><Input label="Как к вам обращаться" value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" disabled={saving} /></div>
        </div>
        {error && <Banner variant="error" title={error} className="mb-4" />}
        <Button type="submit" variant="primary" loading={saving} disabled={!displayName.trim() || processing || saving} className="w-full justify-center">Перейти к работе</Button>
        <p className="mt-4 text-center text-xs leading-5 text-kumo-subtle">Имя и фотографию можно изменить позже в профиле.</p>
      </form>
    </div>
  </main>
}
