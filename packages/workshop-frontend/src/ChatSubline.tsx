import { CaretDown, Folder, GitBranch } from "@phosphor-icons/react";

export function ChatSubline({ chatCount, variantCount = chatCount, variantLabel = "Исходная", projects = [], onBack }: { chatCount: number; variantCount?: number; variantLabel?: string; projects?: readonly { id: string; title: string }[]; onBack(): void }) {
  if (chatCount < 2 && !projects.length) return null;
  return (
    <div data-testid="chat-subline" className="flex flex-shrink-0 px-4 py-1">
      <div aria-label="Контекст беседы" className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-kumo-subtle">
        {chatCount > 1 && (
          <button type="button" onClick={onBack} aria-label={`Выбрать вариант беседы. Сейчас: ${variantLabel}`} className="inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 font-medium text-kumo-default hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-kumo-brand">
            <GitBranch size={14} className="shrink-0 text-kumo-subtle" />
            <span>{variantLabel}</span>
            <span className="text-kumo-subtle">· {variantCount}</span>
            <CaretDown size={14} className="shrink-0 text-kumo-subtle" />
          </button>
        )}
        {projects.length > 0 && <div aria-label="Прикреплённые проекты" className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${chatCount > 1 ? "border-l border-kumo-line pl-3" : ""}`}>
          {projects.map(project => <span key={project.id} title={project.title} className="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5">
            <Folder size={14} className="shrink-0 text-kumo-subtle" />
            <span className="max-w-[240px] truncate">{project.title}</span>
          </span>)}
        </div>}
      </div>
    </div>
  );
}
