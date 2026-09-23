import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo";

/** Ошибка отрисовки не должна оставлять белый экран: человек видит, что раздел не открылся и что делать. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Раздел Mnemos не отрисован", error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-[650px] px-4 py-8 sm:px-8">
        <h1 className="m-0 text-lg font-semibold text-kumo-strong">Раздел не открылся</h1>
        <p className="mt-2 mb-4 text-sm text-kumo-subtle">Обновите страницу. Если ошибка повторяется, передайте подробности администратору.</p>
        <Button size="sm" variant="secondary" onClick={() => location.reload()}>Обновить страницу</Button>
        <details className="mt-4 text-[12px] text-kumo-subtle">
          <summary className="cursor-pointer">Подробности ошибки</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-kumo-elevated p-3 font-mono">{String(error.stack || error.message || error)}</pre>
        </details>
      </div>
    );
  }
}
