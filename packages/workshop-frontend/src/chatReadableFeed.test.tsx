// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
// Лента беседы для человека: без внутренних идентификаторов и с размышлениями по-русски.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { displayName, looksLikeId } from "@gadgets/workshop-shared/code-work";
import { ProjectChips } from "./components/chat/ProjectChips";
import { hideInternalIds, ThinkingTraceRow } from "./ChatInterface";
import { displayChatTitle } from "./chatTitle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });
function render(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const HEX = "03a38c202c53b5715b266813e3cf29b89d923ec237fe0fcec9e41ebf5a8d49b3";
const UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("идентификаторы в ленте и шапке", () => {
  it("идентификатор узнаётся, название — нет", () => {
    expect(looksLikeId(HEX)).toBe(true);
    expect(looksLikeId(UUID)).toBe(true);
    expect(looksLikeId("task_01J9ZK3Q8W7X6V5T4S3R2P1N0M")).toBe(true);
    expect(looksLikeId("Продажи")).toBe(false);
    expect(looksLikeId("mnemos")).toBe(false);
    expect(looksLikeId("Отчёт 2026")).toBe(false);
    expect(displayName(HEX, "проект")).toBe("проект");
    expect(displayName("  ", "проект")).toBe("проект");
    expect(displayName("Склад", "проект")).toBe("Склад");
  });

  it("цель шага без идентификаторов: целиком — убирается, вкрапленный — многоточием", () => {
    expect(hideInternalIds(HEX)).toBeUndefined();
    expect(hideInternalIds(`Проект ${HEX}`)).toBe("Проект …");
    expect(hideInternalIds(`подключение ${UUID}`)).toBe("подключение …");
    expect(hideInternalIds("Продажи")).toBe("Продажи");
    expect(hideInternalIds(undefined)).toBeUndefined();
  });

  it("чип проекта без названия подписан словом, а не идентификатором", () => {
    const view = render(<ProjectChips
      projects={[{ accountId: 1, projectId: HEX, title: HEX, pinnedBy: "agent" }]}
      onChange={vi.fn()}
      loadChoices={async () => []}
    />);
    expect(view.textContent).toContain("Проект");
    expect(view.textContent).not.toContain(HEX.slice(0, 12));
    expect(view.innerHTML).not.toContain(HEX);
  });

  it("беседа с идентификатором вместо названия зовётся «Новая беседа»", () => {
    expect(displayChatTitle(HEX)).toBe("Новая беседа");
    expect(displayChatTitle("Отчёт по продажам")).toBe("Отчёт по продажам");
  });
});

describe("размышления по-русски", () => {
  const EN = "**Planning the search**\n\nI need to find where the config lives before answering.";
  const RU = "**Планирую поиск**\n\nНужно найти, где лежит конфигурация, прежде чем отвечать.";

  it("перевод показывается вместо английского исходника", () => {
    const view = render(<ThinkingTraceRow reasoning={EN} translation={RU} />);
    expect(view.textContent).toContain("Планирую поиск");
    expect(view.textContent).not.toContain("Planning");
  });

  it("русские размышления показываются как есть", () => {
    const view = render(<ThinkingTraceRow reasoning={RU} />);
    expect(view.textContent).toContain("Нужно найти");
  });

  it("пока перевода нет, английский исходник свёрнут и открывается по кнопке", () => {
    const view = render(<ThinkingTraceRow reasoning={EN} />);
    expect(view.textContent).toContain("Размышления переводятся…");
    expect(view.textContent).not.toContain("Planning");
    const toggle = [...view.querySelectorAll("button")].find((b) => b.textContent?.includes("Показать исходный текст"))!;
    act(() => toggle.click());
    expect(view.textContent).toContain("Planning the search");
  });

  it("во время ответа английские размышления не показываются, вместо них «Думает…»", () => {
    const view = render(<ThinkingTraceRow reasoning={EN} streaming />);
    expect(view.textContent).toContain("Думает…");
    expect(view.textContent).not.toContain("Planning");
    const early = render(<ThinkingTraceRow reasoning="I need" streaming />);
    expect(early.textContent).toContain("Думает…");
  });
});
