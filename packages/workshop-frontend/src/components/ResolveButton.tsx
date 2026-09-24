import type { MouseEventHandler } from 'react'

export function ResolveButton({
  tone,
  variant = 'quiet',
  disabled,
  onClick,
}: {
  tone: 'approve' | 'deny'
  variant?: 'quiet' | 'filled'
  disabled: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  const toneClassName = variant === 'filled'
    ? 'h-8 bg-kumo-brand px-4 text-white enabled:hover:bg-kumo-brand-hover'
    : tone === 'approve'
      ? 'h-8 px-4 border border-kumo-fill-hover bg-kumo-overlay text-kumo-default enabled:hover:bg-kumo-tint'
      : 'h-8 px-3 text-kumo-subtle enabled:hover:bg-kumo-tint enabled:hover:text-kumo-danger'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex cursor-pointer items-center rounded-full text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${toneClassName}`}
    >
      {tone === 'approve' ? 'Разрешить' : 'Не разрешать'}
    </button>
  )
}

export function AlwaysApproveButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium text-kumo-subtle transition-colors enabled:hover:bg-kumo-tint enabled:hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-40"
    >
      Разрешать всегда
    </button>
  )
}
