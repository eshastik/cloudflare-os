// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
// Примеры задач на стартовом экране — по проектам человека.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatProjectChoice } from "@gadgets/workshop-shared/api";
import { GENERIC_EXAMPLES, homeExamples, NO_PROJECT_EXAMPLES } from "./homeExamples";
import HomeTaskSuggestions from "./components/AppShell/HomeTaskSuggestions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });
function render(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const project = (title: string, extra: Partial<ChatProjectChoice> = {}): ChatProjectChoice =>
  ({ accountId: 1, projectId: title, title, hasCode: false, ...extra });

describe("примеры задач по проектам", () => {
  it("один проект — три примера, в каждом его название, и все подключают этот проект", () => {
    const examples = homeExamples([project("Продажи")]);
    expect(examples).toHaveLength(3);
    for (const e of examples) {
      expect(e.label).toContain("«Продажи»");
      expect(e.prompt).toContain("«Продажи»");
      expect(e.project?.projectId).toBe("Продажи");
    }
  });

  it("много проектов — не больше четырёх примеров по разным проектам", () => {
    const examples = homeExamples(["Продажи", "Склад", "Кадры", "Бюджет", "Юристы"].map(t => project(t)));
    expect(examples).toHaveLength(4);
    expect(examples.map(e => e.project?.title)).toEqual(["Продажи", "Склад", "Кадры", "Бюджет"]);
  });

  it("проект с кодом получает пример про код", () => {
    const examples = homeExamples([project("Продажи"), project("Сайт", { hasCode: true })]);
    expect(examples.at(-1)).toMatchObject({ label: "Код «Сайт»", project: { title: "Сайт" } });
  });

  it("нет проектов (или только с идентификаторами вместо названий) — начать с папки", () => {
    expect(homeExamples([])).toBe(NO_PROJECT_EXAMPLES);
    expect(homeExamples([project("3fa85f64-5717-4562-b3fc-2c963f66afa6")])).toBe(NO_PROJECT_EXAMPLES);
    expect(NO_PROJECT_EXAMPLES[0].label).toBe("Загрузите папку, чтобы начать");
  });
});

describe("подсказки под полем ввода", () => {
  it("щелчок по примеру отдаёт текст вместе с проектом", () => {
    const onPick = vi.fn();
    const el = render(<HomeTaskSuggestions choices={[project("Склад")]} onPick={onPick} />);
    const button = [...el.querySelectorAll("button")].find(b => b.textContent === "Сводка по «Склад»")!;
    act(() => button.click());
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("проекту «Склад»"), project: expect.objectContaining({ title: "Склад" }),
    }));
  });

  it("без проектов — подсказка про папку; пока грузится — пусто; ошибка — общие примеры", () => {
    expect(render(<HomeTaskSuggestions choices={[]} onPick={() => {}} />).textContent).toContain("Перетащите папку с файлами");
    act(() => root?.unmount()); container?.remove();
    expect(render(<HomeTaskSuggestions choices={null} onPick={() => {}} />).textContent).toBe("");
    act(() => root?.unmount()); container?.remove();
    const failed = render(<HomeTaskSuggestions choices="failed" onPick={() => {}} />);
    expect(failed.textContent).toContain(GENERIC_EXAMPLES[0].label);
  });
});
