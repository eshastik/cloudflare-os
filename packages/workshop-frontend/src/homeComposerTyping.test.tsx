// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
// Быстрый ввод в только что открытое поле «Новой беседы»: пробелы, знаки препинания и латиница
// не должны теряться (дефект 49). Набор повторяет то, как браузер и средства автоматизации
// вводят текст: символ с клавиатуры идёт через keydown → input → keyup, остальные — только input.
// Разбор 24.09: потеря воспроизводилась только вводом через расширение автоматизации Chrome и так же
// случалась на обычном textarea без React; само поле символов не теряет — тест держит это свойство.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  authenticatedApi: {
    listModels: async () => [],
    listChatProjects: async () => [],
    newGadget: () => { throw new Error("не должен создаваться при наборе"); },
    subscribeAccounts: () => () => {},
    listGatekeeperVendors: async () => [],
  } as Record<string, unknown>,
  navigate: () => {},
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => testState.navigate,
}));
vi.mock("./AuthContext", () => ({
  useAuthenticatedApi: () => ({ authenticatedApi: testState.authenticatedApi }),
}));
vi.mock("./useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

import { Toasty, TooltipProvider } from "@cloudflare/kumo";
import { HomePageContent } from "./routes/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// Символы, которые браузер вводит через события клавиатуры (раскладка US).
const KEYBOARD = /^[\x20-\x7e]$/;

function typeChar(textarea: HTMLTextAreaElement, ch: string) {
  const viaKeyboard = KEYBOARD.test(ch);
  let allowed = true;
  if (viaKeyboard) {
    const down = new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true });
    allowed = textarea.dispatchEvent(down);
    if (allowed) {
      allowed = textarea.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true, cancelable: true }));
    }
  }
  if (allowed) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, textarea.value.slice(0, start) + ch + textarea.value.slice(end));
    textarea.setSelectionRange(start + ch.length, start + ch.length);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
  }
  if (viaKeyboard) textarea.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
}

describe("поле ввода новой беседы", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  it("быстрый ввод сразу после открытия сохраняет пробелы, знаки и латиницу", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<TooltipProvider><Toasty><HomePageContent /></Toasty></TooltipProvider>));
    const textarea = container.querySelector("textarea")!;
    expect(textarea).not.toBeNull();
    textarea.focus();
    const phrase = "В проекте с кодом Mnemos найди, где лежит конфиг.";
    // Без пауз между символами: отрисовка догоняет ввод только в конце.
    act(() => { for (const ch of phrase) typeChar(textarea, ch); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(textarea.value).toBe(phrase);
  });
});
