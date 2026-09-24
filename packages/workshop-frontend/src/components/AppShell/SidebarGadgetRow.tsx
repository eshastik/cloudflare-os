import { Link } from '@tanstack/react-router'
import { DotsThree, Star, ShareNetwork, Trash, Pencil } from '@phosphor-icons/react'
import { DropdownMenu } from '@cloudflare/kumo'
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_POSITIONER_STYLE } from '../menuStyles'
import { useState, useEffect, useRef } from 'react'
import type { GadgetMetadataWithTimestamps } from '@gadgets/workshop-shared/api'

function initials(title: string | undefined): string {
  const t = (title || 'Беседа').trim()
  if (!t) return 'Б'
  const parts = t.split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || t.slice(0, 2).toUpperCase()
}

const ROW = 'group flex h-8 items-center gap-2 rounded-[10px] pl-3 pr-1 text-[14px] leading-5 text-kumo-default transition-colors hover:bg-kumo-tint'
const COLLAPSED_ROW = 'group flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors hover:bg-kumo-tint'
// Строка страницы «Все беседы» (макет Chats): крупнее, с подписью под названием.
const LIST_ROW = 'group flex items-center gap-3.5 border-b border-kumo-tint py-3.5 pl-5 pr-3 text-kumo-default transition-colors last:border-b-0 hover:bg-kumo-tint'

// One row in the sidebar's Favorites / Recent list: название беседы и меню действий (избранное,
// переименовать, поделиться, удалить). В свёрнутой панели — только монограмма. Favorite/rename/share/delete
// callbacks are passed in by the parent so this row stays a pure presentational component.
export default function SidebarGadgetRow({
  gadget,
  collapsed = false,
  onTogglePin,
  onRename,
  onShare,
  onDelete,
  variant = 'sidebar',
  subtitle,
}: {
  gadget: GadgetMetadataWithTimestamps
  collapsed?: boolean
  variant?: 'sidebar' | 'list'
  subtitle?: string
  onTogglePin: (g: GadgetMetadataWithTimestamps) => void
  onRename: (g: GadgetMetadataWithTimestamps, newTitle: string) => void
  onShare: (g: GadgetMetadataWithTimestamps) => void
  onDelete: (g: GadgetMetadataWithTimestamps) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(gadget.title || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  const commit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== gadget.title) onRename(gadget, trimmed)
    setRenaming(false)
  }

  const startRename = () => {
    setRenameValue(gadget.title || '')
    setRenaming(true)
  }

  return (
    <Link
      to="/workspace/$id"
      params={{ id: gadget.id }}
      className={variant === 'list' ? LIST_ROW : collapsed ? COLLAPSED_ROW : ROW}
      activeProps={variant === 'list' ? undefined : { className: `${collapsed ? COLLAPSED_ROW : ROW} bg-kumo-fill font-medium` }}
      onClick={(e) => {
        if (renaming) e.preventDefault()
      }}
      title={collapsed ? gadget.title || 'Беседа без названия' : undefined}
    >
      {collapsed && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-kumo-tint text-[11px] font-medium text-kumo-subtle"
          aria-hidden="true"
        >
          {initials(gadget.title)}
        </div>
      )}

      {!collapsed && (
        <>
          {renaming ? (
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className={`min-w-0 flex-1 border-b border-kumo-brand bg-transparent leading-5 text-kumo-default outline-none ${variant === 'list' ? 'text-[15px]' : 'text-[14px]'}`}
              onClick={(e) => e.preventDefault()}
            />
          ) : variant === 'list' ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] leading-5 font-medium">{gadget.title || 'Беседа без названия'}</span>
              {subtitle && <span className="mt-[3px] block truncate text-[13px] leading-4 text-kumo-subtle">{subtitle}</span>}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate">{gadget.title || 'Беседа без названия'}</span>
          )}

          {/* Inside the row's <Link>: stopPropagation blocks the Link's SPA handler, so preventDefault
              is needed to stop the native <a> from navigating. */}
          <div onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>
            <DropdownMenu>
              <DropdownMenu.Trigger
                render={
                  <button
                    type="button"
                    aria-label="Действия с беседой"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-kumo-subtle opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-kumo-fill hover:text-kumo-default focus:opacity-100"
                  >
                    <DotsThree size={14} weight="bold" />
                  </button>
                }
              />
              <DropdownMenu.Content className={MENU_CONTENT} style={MENU_POSITIONER_STYLE}>
                <DropdownMenu.Item
                  onClick={startRename}
                  className={MENU_ITEM}
                >
                  <Pencil size={13} className="mr-2" /> Переименовать
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onClick={() => onTogglePin(gadget)}
                  className={MENU_ITEM}
                >
                  <Star size={13} className="mr-2" weight={gadget.pinned ? 'fill' : 'regular'} />
                  {gadget.pinned ? 'Убрать из избранного' : 'В избранное'}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onClick={() => onShare(gadget)}
                  className={MENU_ITEM}
                >
                  <ShareNetwork size={13} className="mr-2" /> Поделиться
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  variant="danger"
                  onClick={() => onDelete(gadget)}
                  className={MENU_ITEM_DANGER}
                >
                  <Trash size={13} className="mr-2" />
                  {gadget.owner ? 'Убрать' : 'Удалить'}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        </>
      )}

      {/* Collapsed rows show only the monogram (aria-hidden), so name the link for screen readers. */}
      {collapsed && <span className="sr-only">{gadget.title || 'Беседа без названия'}</span>}
    </Link>
  )
}
