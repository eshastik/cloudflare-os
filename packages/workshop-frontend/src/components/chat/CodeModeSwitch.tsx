// Переключатель «Код: Выкл · Авто · Вкл» у поля ввода: кто отвечает на сообщения беседы.
// Значение хранится в метаданных беседы; по умолчанию «Авто».
import type { ChatCodeMode } from "@gadgets/workshop-shared/code-work";

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
  return (
    <div className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] leading-4 text-kumo-inactive">
      <span aria-hidden>Код:</span>
      <div
        role="radiogroup"
        aria-label="Работа с кодом"
        className="inline-flex items-center rounded-full border border-kumo-line bg-kumo-elevated/40 p-px"
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
              className={`cursor-pointer rounded-full px-1.5 py-px transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
                checked ? "bg-kumo-base text-kumo-default shadow-sm" : "text-kumo-inactive hover:text-kumo-default"
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
