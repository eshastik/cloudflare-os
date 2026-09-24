import { Component, type ErrorInfo, type ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { Button } from "./ui.tsx";

/** Ошибка отрисовки не должна оставлять белый экран: человек видит, что раздел не открылся и что делать.
 * Текст ошибки для администратора свёрнут: на основном экране технических строк нет. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Раздел Mnemos не отрисован", error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-[560px] flex-col items-center px-4 py-16 text-center">
        <span aria-hidden="true" className="mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] bg-kumo-warning-tint text-kumo-warning"><WarningCircle size={24} /></span>
        <h1 className="m-0 text-[24px] leading-[30px] font-semibold tracking-[-0.5px] text-kumo-default">Раздел не открылся</h1>
        <p className="mt-2 mb-6 text-[15px] leading-[22px] text-kumo-subtle">Что-то пошло не так при показе этой страницы. Ваши данные не пострадали. Обновите страницу; если ошибка повторится, сообщите администратору.</p>
        <Button onClick={() => location.reload()}>Обновить страницу</Button>
        <details className="mt-8 w-full text-left text-[12px] text-kumo-subtle">
          <summary className="cursor-pointer text-center">Сведения для администратора</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-[12px] bg-kumo-tint p-3 font-mono">{String(error.stack || error.message || error)}</pre>
        </details>
      </div>
    );
  }
}
