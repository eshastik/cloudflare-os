import { CaretDown, GitBranch } from "@phosphor-icons/react";

export function ChatSubline({ chatCount, variantCount = chatCount, variantLabel = "Исходная", projectTitle, onBack }: { chatCount: number; variantCount?: number; variantLabel?: string; projectTitle?: string; onBack(): void }) {
  if (chatCount < 2 && !projectTitle) return null;
  return (
    <div data-testid="chat-subline" className="flex flex-shrink-0 flex-wrap items-center gap-3 px-4 py-3 text-sm text-kumo-subtle">
      {chatCount > 1 && (
        <button type="button" onClick={onBack} aria-label={`Выбрать вариант беседы. Сейчас: ${variantLabel}`} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-kumo-line bg-kumo-base px-3 py-2 text-sm font-medium text-kumo-default shadow-sm hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-kumo-brand">
          <GitBranch size={18} />
          <span>{variantLabel}</span>
          <span className="border-l border-kumo-line pl-2 font-normal text-kumo-subtle">Варианты · {variantCount}</span>
          <CaretDown size={16} />
        </button>
      )}
      {projectTitle && <span className="min-w-0 truncate">Проект: {projectTitle}</span>}
    </div>
  );
}
