import { useState, type ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import AppearanceSettings from './components/AppearanceSettings'
import { useDocumentTitle } from './useDocumentTitle'

// Настройки — только личное. Всё, что касается организации (люди, правила, подключения, агенты,
// модели, журнал), живёт в «Управлении» и видно одному администратору.

type Row = { key: string; title: string; note?: string; link?: LinkProps; onClick?: () => void }

export default function SettingsHub() {
  useDocumentTitle('Настройки')
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  const personal: Row[] = [
    { key: 'profile', title: 'Профиль', note: 'Имя, почта и пароль.', link: { to: '/profile' } },
    { key: 'appearance', title: 'Оформление', note: 'Тема и цвет акцента.', onClick: () => setAppearanceOpen(true) },
    { key: 'outputs', title: 'Результаты бесед', note: 'Документы и файлы, созданные в ваших беседах.', link: { to: '/outputs' } },
  ]

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-6">
        <h1 className="m-0 text-[24px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default">Настройки</h1>
        <p className="mt-1 mb-0 max-w-[650px] text-[14px] leading-5 text-kumo-subtle">Ваш профиль и внешний вид.</p>
      </header>
      <Group title="Личное" rows={personal} />
      {appearanceOpen && <AppearanceSettings open={appearanceOpen} onOpenChange={setAppearanceOpen} />}
    </div>
  )
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section aria-label={title} className="mb-6 max-w-[768px]">
      <h2 className="mt-0 mb-2 text-[15px] font-semibold text-kumo-strong">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
        {rows.map(row => <RowItem key={row.key} row={row} />)}
      </div>
    </section>
  )
}

function RowItem({ row }: { row: Row }) {
  const body: ReactNode = (
    <>
      <span className="block text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-kumo-default">{row.title}</span>
      {row.note && <span className="mt-0.5 block text-[12px] leading-4 text-kumo-subtle">{row.note}</span>}
    </>
  )
  const className = 'block w-full border-t border-kumo-line p-3 text-left first:border-t-0 hover:bg-kumo-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring'
  if (row.link) return <Link {...row.link} className={className}>{body}</Link>
  return <button type="button" onClick={row.onClick} className={`${className} cursor-pointer`}>{body}</button>
}
