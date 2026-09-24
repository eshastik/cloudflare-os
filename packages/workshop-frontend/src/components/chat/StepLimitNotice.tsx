import { ArrowRight, HourglassMedium } from "@phosphor-icons/react";

// Отметка «агент остановился на пределе шагов». Это не ошибка: работа сохранена, итог агент
// написал выше, а «Продолжить» запускает тот же ход дальше без нового сообщения человека.
export function StepLimitNotice({ message, canContinue, onContinue }: {
  message: string;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="max-w-[860px] text-[14px] leading-5 tracking-[-0.25px] text-kumo-subtle" role="status">
      <div className="flex w-full items-center gap-2 px-1.5 py-1">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-kumo-inactive" aria-hidden="true">
          <HourglassMedium size={16} />
        </span>
        <span className="min-w-0 flex-1">{message}</span>
        {canContinue && (
          <button
            type="button"
            onClick={onContinue}
            className="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-md bg-kumo-brand px-2 py-1 text-[13px] leading-4 font-medium text-white transition-[background-color,transform] duration-150 ease-out hover:bg-kumo-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring active:scale-[0.98]"
          >
            Продолжить
            <ArrowRight size={12} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}
