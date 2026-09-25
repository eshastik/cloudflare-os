// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import CorporateWorkContext from "./CorporateWorkContext";
import { sourceTurnCount } from "./corporate-work-context";
import type { OpenDocument } from "./components/chat/WorkSteps";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });
function render(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

function observation(sequence: number, context?: { projectName: string; resourceName?: string }, activity?: Record<string, unknown>): AiChatMessage {
  return {
    chatId: 1, sequence, timestamp: new Date(), author: { type: "agent", id: "agent", name: "Помощник" },
    type: "action", actionId: sequence,
    actionLog: { id: sequence, type: "observation", state: "approved", createdAt: new Date(), resourceTitle: "Mnemos", description: { title: "Материалы Mnemos", description: "…", workContext: context, activity } },
  } as AiChatMessage;
}

function ask(sequence: number, text: string): AiChatMessage {
  return { chatId: 1, sequence, timestamp: new Date(), author: { type: "user", id: "anna", name: "Анна" }, type: "message", message: text } as AiChatMessage;
}

const projectId = "03df01061ae3e9db16ba4f6ed0531c04";
/** Два хода агента с материалами: итог беседы нужен, потому что источники разнесены по ходам. */
function withMaterials(): readonly AiChatMessage[] {
  return [
    ask(1, "Что за модель?"),
    observation(2, { projectName: "Красноярский лев" }, { scopeId: projectId }),
    ask(3, "А что в README?"),
    observation(4, { projectName: "Красноярский лев", resourceName: "README.md" }, { scopeId: projectId, items: [{ name: "README.md", documentId: "doc-1" }] }),
  ];
}

describe("итог использованных материалов беседы", () => {
  it("в пустой беседе и без наблюдений ничего не показывает", () => {
    const view = render(<CorporateWorkContext messages={[]} />);
    expect(view.querySelector('[data-testid="corporate-work-context"]')).toBeNull();
    expect(view.textContent).toBe("");
  });

  it("если материалы только в одном ходе, итог не показывается: их уже показывает сам ход", () => {
    const messages = [
      ask(1, "Что за модель?"),
      observation(2, { projectName: "Красноярский лев" }, { scopeId: projectId }),
      observation(3, { projectName: "Красноярский лев", resourceName: "README.md" }, { scopeId: projectId, items: [{ name: "README.md", documentId: "doc-1" }] }),
      ask(4, "Спасибо"),
    ];
    const view = render(<CorporateWorkContext messages={messages} />);
    expect(view.querySelector('[data-testid="corporate-work-context"]')).toBeNull();
  });

  it("неодобренные наблюдения не делают беседу многоходовой", () => {
    const rejected = { ...observation(4, { projectName: "Закупки" }), actionLog: { ...(observation(4, { projectName: "Закупки" }) as any).actionLog, state: "rejected" } } as AiChatMessage;
    const messages = [ask(1, "Что за модель?"), observation(2, { projectName: "Красноярский лев" }, { scopeId: projectId }), ask(3, "А закупки?"), rejected];
    expect(sourceTurnCount(messages)).toBe(1);
    expect(render(<CorporateWorkContext messages={messages} />).textContent).toBe("");
  });

  it("при материалах в двух ходах показывает итог, свёрнутый по умолчанию", () => {
    const view = render(<CorporateWorkContext messages={withMaterials()} />);
    const section = view.querySelector('[data-testid="corporate-work-context"]');
    expect(section).not.toBeNull();
    expect(section!.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
    expect(view.textContent).toContain("Красноярский лев");
    expect(view.textContent).toContain("1 проект");
    // Список документов скрыт, пока карточка не раскрыта.
    expect(view.textContent).not.toContain("README.md");
  });

  it("раскрывается по клику и показывает документ; повторный клик сворачивает", () => {
    const view = render(<CorporateWorkContext messages={withMaterials()} />);
    const toggle = view.querySelector('[data-testid="corporate-work-context"] button')!;
    act(() => (toggle as HTMLButtonElement).click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(view.textContent).toContain("README.md");
    expect(view.textContent).toContain("Доступ проверяется при каждом открытии");
    act(() => (toggle as HTMLButtonElement).click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(view.textContent).not.toContain("README.md");
  });

  it("ссылки открывают проект и документ через openDocument, передавая идентификаторы и resourceTitle", () => {
    const opened: unknown[] = [];
    const openDocument: OpenDocument = (link) => { opened.push(link); return () => { opened.push({ clicked: link }); }; };
    const view = render(<CorporateWorkContext messages={withMaterials()} openDocument={openDocument} />);
    act(() => (view.querySelector('[data-testid="corporate-work-context"] button') as HTMLButtonElement).click());

    const projectLink = [...view.querySelectorAll("button")].find(b => b.textContent === "Красноярский лев")!;
    act(() => projectLink.click());
    expect(opened).toContainEqual({ clicked: { project: projectId, resourceTitle: "Mnemos" } });

    const docLink = [...view.querySelectorAll("button")].find(b => b.textContent === "README.md")!;
    act(() => docLink.click());
    expect(opened).toContainEqual({ clicked: { project: projectId, document: "doc-1", resourceTitle: "Mnemos" } });
  });

  it("без openDocument проект и документ показаны текстом, не ссылкой", () => {
    const view = render(<CorporateWorkContext messages={withMaterials()} />);
    act(() => (view.querySelector('[data-testid="corporate-work-context"] button') as HTMLButtonElement).click());
    expect([...view.querySelectorAll("button")].some(b => b.textContent === "Красноярский лев")).toBe(false);
    expect(view.textContent).toContain("Красноярский лев");
  });

  it("считает документы нескольких проектов в общем счётчике", () => {
    const messages = [
      ...withMaterials(),
      ask(5, "Сравни со сметой"),
      observation(6, { projectName: "Закупки", resourceName: "Смета" }, { scopeId: "b2", items: [{ name: "Смета", documentId: "doc-2" }] }),
    ];
    const view = render(<CorporateWorkContext messages={messages} />);
    expect(view.textContent).toContain("2 проекта");
    expect(view.textContent).toContain("2 документа");
  });

  it("в ChatInterface итог стоит внутри прокручиваемого потока, после сообщений, и не во время работы агента", () => {
    const source = Object.values(import.meta.glob<string>("./ChatInterface.tsx", { query: "?raw", import: "default", eager: true }))[0];
    const uses = [...source.matchAll(/<CorporateWorkContext\b/g)].map(match => match.index!);
    expect(uses).toHaveLength(1);
    const scroller = source.indexOf("ref={messagesContainerRef}");
    const composer = source.indexOf("Bottom: input");
    const lastMessages = source.lastIndexOf("displayEntries.map(");
    expect(scroller).toBeGreaterThan(0);
    expect(uses[0]).toBeGreaterThan(Math.max(scroller, lastMessages));
    expect(uses[0]).toBeLessThan(composer);
    expect(source.slice(uses[0] - 40, uses[0])).toContain("!isAgentActive &&");
  });
});
