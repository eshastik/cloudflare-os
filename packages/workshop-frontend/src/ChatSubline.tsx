import { CaretLeft } from "@phosphor-icons/react";

// The workspace header names and renames the conversation. Inside it only a way
// back to several chats and the project remain; with one chat and no project
// nothing is shown.
export function ChatSubline({ chatCount, projectTitle, onBack }: { chatCount: number; projectTitle?: string; onBack(): void }) {
  if (chatCount < 2 && !projectTitle) return null;
  return (
    <div data-testid="chat-subline" className="flex flex-shrink-0 items-center gap-3 px-4 pt-2 text-[12px] leading-4 text-kumo-subtle">
      {chatCount > 1 && (
        <button type="button" onClick={onBack} className="inline-flex cursor-pointer items-center gap-1 rounded-md hover:text-kumo-default">
          <CaretLeft size={12} />
          Все чаты · {chatCount}
        </button>
      )}
      {projectTitle && <span className="min-w-0 truncate">Проект: {projectTitle}</span>}
    </div>
  );
}
