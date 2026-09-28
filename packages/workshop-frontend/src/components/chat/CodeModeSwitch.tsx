// Переключатель «Код: Авто ▾» в нижней строке поля ввода: кто отвечает на сообщения беседы.
// Значение хранится в метаданных беседы; по умолчанию «Авто».
import { useEffect, useState } from "react";
import { CaretDown, Check, Code } from "@phosphor-icons/react";
import type { ChatCodeMode } from "@gadgets/workshop-shared/code-work";
import { COMPOSER_CHIP, COMPOSER_POPOVER, useDismiss } from "./ProjectChips";

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
  const [open, setOpen] = useState(false);
  const rootRef = useDismiss(open, () => setOpen(false));
  const current = OPTIONS.find((option) => option.mode === mode) ?? OPTIONS[1];
  return (
    <div ref={rootRef} className="inline-flex min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Работа с кодом: ${current.label}`}
        title={current.hint}
        className={COMPOSER_CHIP}
      >
        <Code size={15} className="flex-shrink-0" />
        <span className="truncate"><span className="max-sm:hidden">Код: </span>{current.label}</span>
        <CaretDown size={11} className="flex-shrink-0 opacity-70" aria-hidden="true" />
      </button>
      {open && (
        <div className={COMPOSER_POPOVER}>
          <p className="m-0 px-2.5 pt-1.5 pb-1 text-[12px] leading-4 text-kumo-subtle">Кто отвечает на сообщения беседы</p>
          <div role="radiogroup" aria-label="Работа с кодом" className="flex flex-col">
            {OPTIONS.map((option) => {
              const checked = option.mode === mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  title={option.hint}
                  onClick={() => { setOpen(false); if (!checked) onChange(option.mode); }}
                  className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
                >
                  <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center text-kumo-brand">{checked && <Check size={13} weight="bold" />}</span>
                  <span className="min-w-0">
                    <span className={`block text-kumo-default ${checked ? "font-medium" : ""}`}>{option.label}</span>
                    <span className="block text-[12px] leading-4 text-kumo-subtle">{option.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
