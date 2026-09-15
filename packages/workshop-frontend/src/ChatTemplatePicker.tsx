import { useEffect, useState } from 'react'
import { Dialog } from '@cloudflare/kumo'
import { Blueprint, MagnifyingGlass, X } from '@phosphor-icons/react'
import type { AuthenticatedApi, OutputFormatOffer } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton, WorkshopIconButton } from './components/WorkshopControls'
import { FormatGlyph } from './components/format/FormatVisuals'

export type ChatTemplate = { id: string; title: string; description: string; format?: OutputFormatOffer }
type CatalogApi = Pick<AuthenticatedApi, 'listOwnBlueprints' | 'listLibraryBlueprints' | 'listFeaturedBlueprints' | 'listOutputFormats'>

export async function loadChatTemplates(api: CatalogApi): Promise<{ items: ChatTemplate[]; failed: number }> {
  const results = await Promise.allSettled([
    api.listOutputFormats().then(items => items.map(format => ({ id: format.blueprintId, title: format.output.noun, description: format.description, format }))),
    api.listOwnBlueprints().then(items => items.map(({ id, title, description }) => ({ id, title, description }))),
    api.listLibraryBlueprints().then(items => items.map(({ id, metadata }) => ({ id, title: metadata.title, description: metadata.description }))),
    api.listFeaturedBlueprints().then(items => items.map(({ id, metadata }) => ({ id, title: metadata.title, description: metadata.description }))),
  ])
  const items = new Map<string, ChatTemplate>()
  for (const result of results) if (result.status === 'fulfilled') {
    for (const item of result.value) if (!items.has(item.id)) items.set(item.id, item)
  }
  return { items: [...items.values()], failed: results.filter(result => result.status === 'rejected').length }
}

/** Ссылка указывает точный шаблон платформы, но не выдаёт агенту новых прав. */
export function messageWithTemplate(message: string, template: ChatTemplate | null, origin: string): string {
  if (!template) return message
  const title = template.title.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ')
  return `${message}\n\nШаблон: [${title}](${origin}/blueprint/${encodeURIComponent(template.id)})`
}

export default function ChatTemplatePicker({ onSelect, onClose }: { onSelect(template: ChatTemplate): void; onClose(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<{ items: ChatTemplate[]; failed: number } | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setCatalog(null)
    void loadChatTemplates(authenticatedApi).then(value => { if (active) setCatalog(value) })
    return () => { active = false }
  }, [authenticatedApi, reload])
  const items = catalog?.items.filter(item => `${item.title} ${item.description}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim())) ?? []
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog size="base" className="!z-[1200] !w-[min(560px,calc(100vw-24px))] overflow-hidden bg-kumo-base !p-0">
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div>
          <Dialog.Title className="text-[17px] font-medium text-kumo-default">С чего начнём?</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] text-kumo-subtle">Выберите шаблон и опишите задачу в беседе.</Dialog.Description>
        </div>
        <WorkshopIconButton aria-label="Закрыть выбор шаблона" onClick={onClose}><X size={18} /></WorkshopIconButton>
      </div>
      <label className="mx-5 mb-3 flex h-10 items-center gap-2 rounded-lg border border-kumo-line px-3 focus-within:border-kumo-brand">
        <MagnifyingGlass size={16} className="text-kumo-inactive" />
        <input autoFocus aria-label="Поиск шаблона" placeholder="Найти шаблон…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] text-kumo-default outline-none" />
      </label>
      <div className="max-h-[min(55vh,440px)] overflow-y-auto px-2 pb-3" aria-label="Шаблоны платформы">
        {!catalog && <p role="status" className="px-3 py-5 text-[13px] text-kumo-subtle">Загрузка шаблонов…</p>}
        {!!catalog?.failed && <div role="status" className="mx-3 mb-2 text-[13px] text-kumo-subtle">Часть шаблонов не загрузилась. <WorkshopButton onClick={() => setReload(value => value + 1)}>Повторить</WorkshopButton></div>}
        {catalog && !items.length && <p className="px-3 py-5 text-[13px] text-kumo-subtle">{query ? 'Подходящих шаблонов нет. Попробуйте другое название.' : catalog.failed ? 'Каталог пока недоступен.' : 'Сохранённых шаблонов пока нет. Опишите задачу в чате — можно начать с чистого документа.'}</p>}
        {items.map(item => <button key={item.id} type="button" onClick={() => onSelect(item)} className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-kumo-brand">
          <span className="mt-0.5 text-kumo-subtle">{item.format ? <FormatGlyph output={item.format.output} size="md" /> : <Blueprint size={20} />}</span>
          <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-kumo-default">{item.title || 'Без названия'}</span>{item.description && <span className="mt-0.5 block line-clamp-2 text-[12px] leading-[18px] text-kumo-subtle">{item.description}</span>}</span>
        </button>)}
      </div>
    </Dialog>
  </Dialog.Root>
}
