import { createFileRoute } from '@tanstack/react-router'
import { BookOpen, Sparkle, type Icon as PhosphorIcon } from '@phosphor-icons/react'
import { useDocumentTitle } from '../useDocumentTitle'
import ComingSoonPreview from '../components/ComingSoonPreview'
import { useSiteName } from '../ServerConfigContext'

// Context & Skills. The knowledge/skills surface isn't built into the rail yet — agents read
// curated collections of documents (context) and reusable skills. Until then this page shows a
// frosted design mock so the nav entry has a stable, on-language target.
export const Route = createFileRoute('/context')({
  component: ContextPage,
})

type Kind = 'collection' | 'skill'

interface ContextItem {
  id: string
  name: string
  kind: Kind
  detail: string
  updated: string
}

const TYPE_META: Record<Kind, { label: string; Icon: PhosphorIcon }> = {
  collection: { label: 'Подборка', Icon: BookOpen },
  skill: { label: 'Навык', Icon: Sparkle },
}

const MOCK_ITEMS: ContextItem[] = [
  { id: '1', name: 'Справочник сотрудника', kind: 'collection', detail: '12 документов', updated: '2 дн назад' },
  { id: '2', name: 'Стиль и тон компании', kind: 'collection', detail: '5 документов', updated: '1 нед назад' },
  { id: '3', name: 'Описание API', kind: 'collection', detail: '28 документов', updated: '1 нед назад' },
  { id: '4', name: 'Краткий итог встречи', kind: 'skill', detail: 'Готовый навык', updated: '3 дн назад' },
  { id: '5', name: 'Правила продаж', kind: 'collection', detail: '9 документов', updated: '2 нед назад' },
  { id: '6', name: 'Черновик письма клиенту', kind: 'skill', detail: 'Готовый навык', updated: '2 нед назад' },
]

function ContextRow({ item }: { item: ContextItem }) {
  const { label, Icon } = TYPE_META[item.kind]
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kumo-fill text-kumo-subtle">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium tracking-[-0.25px] text-kumo-default">{item.name}</p>
        <p className="mt-0.5 truncate text-[12px] leading-4 tracking-[-0.2px] text-kumo-subtle">
          {label} · {item.detail}
        </p>
      </div>
      <span className="hidden shrink-0 text-xs tracking-[-0.1px] text-kumo-inactive lg:block">
        {item.updated}
      </span>
    </div>
  )
}

function ContextPage() {
  useDocumentTitle('Знания и навыки')
  const siteName = useSiteName()
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 sm:px-10">
      <header className="px-3 pb-4 pt-10">
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">Знания и навыки</h1>
        <p className="mt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          Подборки знаний, которые читают агенты, и готовые навыки, которые они применяют.
        </p>
      </header>

      <ComingSoonPreview
        icon={BookOpen}
        title={`Знания и навыки скоро появятся в ${siteName}`}
        description="Так будет выглядеть работа с подборками знаний и навыками для агентов."
      >
        <div className="chat-panel min-h-0 flex-1 overflow-y-auto pb-8 pt-1">
          <div className="flex flex-col gap-0.5">
            {MOCK_ITEMS.map((item) => (
              <ContextRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      </ComingSoonPreview>
    </div>
  )
}
