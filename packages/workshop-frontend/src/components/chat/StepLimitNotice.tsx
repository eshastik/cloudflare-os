import { Clock } from "@phosphor-icons/react";

// Отметка «агент остановился на пределе шагов». Это не ошибка: работа сохранена, итог агент
// написал выше, а «Продолжить» запускает тот же ход дальше без нового сообщения человека.
// Оформление — серая плашка из макета «Агент работает»: часы, текст, тёмная кнопка.
export function StepLimitNotice({ message, canContinue, onContinue }: {
  message: string;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <div
      className="flex max-w-[720px] items-center gap-3 rounded-[14px] bg-kumo-tint px-4 py-3 text-[14px] leading-5 text-kumo-default"
      role="status"
    >
      <Clock size={16} className="flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      {canContinue && (
        <button
          type="button"
          onClick={onContinue}
          className="h-8 flex-shrink-0 cursor-pointer rounded-full bg-kumo-contrast px-3.5 text-[13px] leading-4 text-white transition-opacity duration-150 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring active:scale-[0.98]"
        >
          Продолжить
        </button>
      )}
    </div>
  );
}
