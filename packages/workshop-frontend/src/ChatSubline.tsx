import { CaretLeft } from "@phosphor-icons/react";

// The workspace header names and renames the conversation. Inside it only a way
// back to several chats and the project remain; with one chat and no project
// nothing is shown.
export function ChatSubline({ chatCount, projectTitle, onBack }: { chatCount: number; projectTitle?: string; onBack(): void }) {
  if (chatCount < 2 && !projectTitle) return null;
  return (
    <div data-testid="chat-subline" className="flex flex-shrink-0 items-center gap-3 px-4 pt-2 text-[12px] leading-4 text-kumo-subtle">
      {chatCount > 1 && (
        <button type="button" onClick={onBack} className="-ml-1 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1 hover:text-kumo-default touch:h-10">
          <CaretLeft size={12} />
          Все беседы
          <span className="rounded-full bg-kumo-fill px-1.5 text-[11px] leading-[18px] font-medium">{chatCount}</span>
        </button>
      )}
      {projectTitle && <span className="min-w-0 truncate">Проект: {projectTitle}</span>}
    </div>
  );
}
