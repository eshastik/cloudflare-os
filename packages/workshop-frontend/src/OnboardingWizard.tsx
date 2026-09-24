import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Banner } from '@cloudflare/kumo'
import { CaretRight, Hexagon } from '@phosphor-icons/react'
import { useAuthenticatedApi } from './AuthContext'
import { useSiteName } from './ServerConfigContext'
import SiteLogo from './components/SiteLogo'
import { useDocumentTitle } from './useDocumentTitle'

/** Примеры первого вопроса: по ним видно, что агент уже знает документы отдела. */
export const WELCOME_PROMPTS = [
  'Расскажи, над чем сейчас работает мой отдел',
  'Какие документы ждут моего согласования?',
  'Где найти регламенты и инструкции отдела?',
]

/** Имя, заданное человеком, начинается с заглавной; имя из почты (anna.petrova) — нет, его не показываем. */
function greetingName(name: string | undefined): string | undefined {
  const trimmed = name?.trim()
  return trimmed && /^\p{Lu}/u.test(trimmed) ? trimmed : undefined
}

/** Первый вход — короткое приветствие по макету Welcome, без мастеров настройки. Показывается
 * один раз: после любого действия оболочка запоминает, что знакомство пройдено. */
export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const { authenticatedApi, currentUser } = useAuthenticatedApi()
  const siteName = useSiteName()
  const navigate = useNavigate()
  useDocumentTitle('Добро пожаловать')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const name = greetingName(currentUser?.name)

  async function begin(prompt?: string) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await authenticatedApi.completeOnboarding()
      if (!mounted.current) return
      onComplete()
      await navigate({ to: '/', search: prompt ? { prompt } : {} })
    } catch {
      if (mounted.current) { setError('Не удалось начать работу. Повторите попытку.'); setSaving(false) }
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-kumo-base px-4 py-10">
    <div className="flex w-full max-w-[560px] flex-col items-center gap-[22px] text-center">
      <SiteLogo size={48}><Hexagon size={48} className="text-kumo-brand" /></SiteLogo>
      <h1 className="m-0 text-[32px] leading-tight font-semibold tracking-[-1px] text-kumo-default sm:text-[40px]">
        {name ? `${name}, добро пожаловать` : 'Добро пожаловать'}
      </h1>
      <p className="m-0 max-w-[460px] text-[17px] leading-[1.55] text-kumo-subtle">
        Вы в {siteName}. Вам уже доступны проекты вашего отдела — просто спросите о чём угодно.
      </p>
      <div className="mt-2 flex w-full flex-col gap-2.5">
        {WELCOME_PROMPTS.map(prompt => (
          <button key={prompt} type="button" disabled={saving} onClick={() => void begin(prompt)}
            className="flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border border-kumo-line bg-kumo-overlay px-[18px] py-4 text-left text-[15px] text-kumo-default hover:border-kumo-brand disabled:opacity-60">
            <span className="flex-1">{prompt}</span>
            <CaretRight size={16} className="text-kumo-subtle" />
          </button>
        ))}
      </div>
      {error && <Banner variant="error" title={error} className="w-full" />}
      <button type="button" disabled={saving} onClick={() => void begin()}
        className="mt-2 flex h-[46px] cursor-pointer items-center rounded-[23px] border-0 bg-kumo-brand px-6 text-[15px] font-semibold text-white hover:bg-kumo-brand-hover disabled:opacity-60">
        Начать
      </button>
    </div>
  </main>
}
