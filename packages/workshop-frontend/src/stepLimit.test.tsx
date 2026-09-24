// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
// Остановка агента на пределе шагов: не ошибка, а «Продолжить».

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepLimitNotice } from "./components/chat/StepLimitNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });
function render(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const TEXT = "Агент сделал 100 шагов и остановился. Нажмите «Продолжить», чтобы он доделал работу.";

describe("отметка о пределе шагов", () => {
  it("показывает текст без слова «Ошибка» и кнопку «Продолжить», которая продолжает ход", () => {
    const onContinue = vi.fn();
    const el = render(<StepLimitNotice message={TEXT} canContinue onContinue={onContinue} />);
    expect(el.textContent).toContain(TEXT);
    expect(el.textContent).not.toContain("Ошибка");
    const button = [...el.querySelectorAll("button")].find(b => b.textContent === "Продолжить");
    expect(button).toBeTruthy();
    act(() => button!.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("у старой отметки или пока агент работает кнопки нет", () => {
    const el = render(<StepLimitNotice message={TEXT} canContinue={false} onContinue={() => {}} />);
    expect(el.querySelector("button")).toBeNull();
  });
});
