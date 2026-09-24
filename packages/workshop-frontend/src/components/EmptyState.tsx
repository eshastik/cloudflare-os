import { PlugsConnected, type Icon } from '@phosphor-icons/react'
import { WorkshopButton } from './WorkshopControls'

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon: EmptyIcon = PlugsConnected,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  icon?: Icon
}) {
  // Пустое состояние по макету: белая карточка с тонкой линией, значок, одна фраза и действие.
  return (
    <div className="rounded-[18px] border border-kumo-fill bg-kumo-overlay px-6 py-9 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-kumo-tint text-kumo-subtle">
        <EmptyIcon size={20} />
      </div>
      <p className="m-0 text-[15px] leading-5 font-semibold text-kumo-default">
        {title}
      </p>
      <p className="mx-auto mt-1 mb-0 max-w-sm text-[14px] leading-5 text-kumo-subtle">
        {description}
      </p>
      {actionLabel && onAction && (
        <WorkshopButton
          className="mx-auto mt-4"
          onClick={onAction}
        >
          {actionLabel}
        </WorkshopButton>
      )}
    </div>
  )
}
