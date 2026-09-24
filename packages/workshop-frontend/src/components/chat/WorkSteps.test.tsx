// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
// Ход работы в беседе: итоговая строка раскрывает шаги, однотипные шаги свёрнуты, строка шага
// раскрывает найденное со ссылками; идущий шаг показывает таймер.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiToolCall } from "@gadgets/workshop-shared/api";
import { LiveStep, WorkRun } from "./WorkSteps";
import type { ObservationRecord, WorkBatch } from "./toolDisplay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; vi.useRealTimers(); });
function render(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(node));
  return container;
}
const click = (view: HTMLElement, text: string) => {
  const button = [...view.querySelectorAll("button")].find(b => b.textContent?.includes(text));
  if (!button) throw new Error(`нет кнопки «${text}»: ${view.textContent}`);
  act(() => button.click());
};

const LION = "03df01061ae3e9db16ba4f6ed0531c04";
let seq = 0;
const obs = (title: string, description: string, extra: Partial<ObservationRecord> = {}): ObservationRecord =>
  ({ chatId: 1, sequence: ++seq, resourceTitle: "Mnemos", title, description, ...extra });
const code = { toolCallId: "c1", toolName: "executeCode", input: { code: "await env.MNEMOS.searchProject(p, q)" }, output: "[]" } as unknown as AiToolCall;

const batches: WorkBatch[] = [{ calls: [code], observations: [
  obs("Поиск в Mnemos", `Проект «${LION}», запрос: «киоск».`, { activity: { kind: "mnemos.search", ref: "a", scope: "Красноярский лев", scopeId: LION, subject: "киоск" } }),
  obs("Материалы Mnemos", "Поиск выполнен.", { workContext: { projectName: "Красноярский лев" }, activity: { kind: "mnemos.result", ref: "a", total: 2, items: [
    { name: "kiosk.tsx", path: "фронтенд/kiosk.tsx", snippet: "export function Kiosk()", projectId: LION, documentId: "n1" },
    { name: "audio.ts", projectId: LION, documentId: "n2" },
  ] } }),
  obs("Поиск в Mnemos", `Проект «${LION}», запрос: «микрофон».`),
  obs("Материалы Mnemos", "Поиск выполнен.", { workContext: { projectName: "Красноярский лев" } }),
] }];

function Harness({ openDocument }: { openDocument: (link: { project: string; document?: string }) => () => void }) {
  const [open, setOpen] = useState(false);
  return <WorkRun batches={batches} startedAt={new Date(0)} finishedAt={new Date(42_000)} open={open} onToggle={() => setOpen(v => !v)} openDocument={openDocument} />;
}

describe("ход работы в беседе", () => {
  it("свёрнут в итог; раскрывается до шагов и найденных документов со ссылками", () => {
    const opened = vi.fn();
    const openDocument = vi.fn((link: { project: string; document?: string }) => () => opened(link));
    const view = render(<Harness openDocument={openDocument} />);
    expect(view.textContent).toBe("Готово за 42 с · 2 поиска, 1 запуск кода");
    click(view, "Готово за 42 с");
    expect(view.textContent).toContain("Искал в «Красноярский лев» 2 раза");
    click(view, "Искал в «Красноярский лев» 2 раза");
    expect(view.textContent).toContain("Искал «киоск» в «Красноярский лев»· 2 совпадения");
    click(view, "Искал «киоск»");
    expect(view.textContent).toContain("фронтенд/kiosk.tsx");
    expect(view.textContent).toContain("export function Kiosk()");
    click(view, "kiosk.tsx");
    expect(opened).toHaveBeenCalledWith({ project: LION, document: "n1", resourceTitle: "Mnemos" });
    click(view, "Искал «микрофон»");
    expect(view.textContent).toContain("Что нашлось, в истории этой беседы не сохранено.");
    expect(view.innerHTML).not.toContain(LION);
  });

  it("один шаг — одна строка без итоговой", () => {
    const view = render(<WorkRun batches={[{ calls: [{ toolCallId: "r", toolName: "readFile", input: { filename: "README.md" } } as unknown as AiToolCall], observations: [] }]} open={false} onToggle={() => {}} />);
    expect(view.textContent).toBe("Прочитал README.md");
  });

  it("идущий шаг: настоящее время и таймер", () => {
    vi.useFakeTimers();
    const view = render(<LiveStep label="Ищу" startedAt={Date.now()} />);
    expect(view.textContent).toBe("Ищу…");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(view.textContent).toBe("Ищу…3 с");
  });
});
