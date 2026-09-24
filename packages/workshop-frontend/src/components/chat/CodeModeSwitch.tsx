// Переключатель «Код: Выкл · Авто · Вкл» у поля ввода: кто отвечает на сообщения беседы.
// Значение хранится в метаданных беседы; по умолчанию «Авто».
import { useEffect, useState } from "react";
import type { ChatCodeMode } from "@gadgets/workshop-shared/code-work";

/** Право человека «Агент кода» (его включает администратор). Пока не прочитано и при сбое — нет:
 *  переключатель без права только ввёл бы в заблуждение, а окончательно право проверяет сервер. */
export function useCodeWorkAllowed(load: () => Promise<boolean>): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let current = true;
    Promise.resolve().then(load).then(value => { if (current) setAllowed(value === true); }, () => { if (current) setAllowed(false); });
    return () => { current = false; };
  }, [load]);
  return allowed;
}

const OPTIONS: { mode: ChatCodeMode; label: string; hint: string }[] = [
  { mode: "off", label: "Выкл", hint: "Отвечает только агент беседы. С кодом проекта он не работает." },
  { mode: "auto", label: "Авто", hint: "Каждое сообщение разбирается по смыслу: просьбы про код уходят агенту кода, остальное — агенту беседы." },
  { mode: "on", label: "Вкл", hint: "Каждое сообщение сразу уходит агенту кода в проекте беседы с кодом." },
];

export type CodeModeSwitchProps = {
  mode: ChatCodeMode;
  onChange(mode: ChatCodeMode): void;
  disabled?: boolean;
};

export function CodeModeSwitch({ mode, onChange, disabled = false }: CodeModeSwitchProps) {
  // Сегментный переключатель по макету «Работа с кодом»: подпись «Код:» и три положения.
  return (
    <div className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-xl bg-kumo-tint p-[3px] text-[13px] leading-4">
      <span aria-hidden className="pr-2 pl-1.5 text-kumo-subtle">Код:</span>
      <div
        role="radiogroup"
        aria-label="Работа с кодом"
        className="inline-flex items-center gap-0.5"
      >
        {OPTIONS.map((option) => {
          const checked = option.mode === mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={checked}
              title={option.hint}
              disabled={disabled}
              onClick={() => { if (!checked) onChange(option.mode); }}
              className={`h-[26px] cursor-pointer rounded-[9px] px-2.5 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                checked
                  ? "bg-kumo-overlay font-semibold text-kumo-default shadow-[0_1px_2px_rgba(24,32,28,0.12)]"
                  : "text-kumo-subtle hover:text-kumo-default"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
