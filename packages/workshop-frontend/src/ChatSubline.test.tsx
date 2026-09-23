// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSubline } from "./ChatSubline";
import { SectionCount } from "./components/AppShell/SectionCount";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });
function render(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

describe("строка под шапкой беседы", () => {
  it("с одним чатом и без проекта ничего не показывает — ни названия, ни удаления", () => {
    const view = render(<ChatSubline chatCount={1} onBack={() => {}} />);
    expect(view.querySelector('[data-testid="chat-subline"]')).toBeNull();
    expect(view.querySelector('[aria-label="Удалить беседу"]')).toBeNull();
    expect(view.textContent).toBe("");
  });
  it("при нескольких чатах ведёт к их списку, проект показан строкой", () => {
    const back = vi.fn();
    const view = render(<ChatSubline chatCount={3} projectTitle="Mnemos" onBack={back} />);
    expect(view.textContent).toContain("Все чаты · 3");
    expect(view.textContent).toContain("Проект: Mnemos");
    act(() => view.querySelector("button")!.click());
    expect(back).toHaveBeenCalledOnce();
  });
});

describe("счётчик раздела в левой колонке", () => {
  it("показывает только положительное целое и сокращает большие", () => {
    expect(render(<SectionCount count={3} />).textContent).toBe("3");
    act(() => root!.render(<SectionCount count={150} />));
    expect(container!.textContent).toBe("99+");
    for (const count of [0, -1, 1.5, undefined]) {
      act(() => root!.render(<SectionCount count={count} />));
      expect(container!.querySelector('[data-testid="section-count"]')).toBeNull();
    }
  });
});
