// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import { GadgetWorkCard, hideGadgetLinks, savedGadgetResources, type SavedGadget } from "./GadgetWorkCard";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

const saved: SavedGadget = {
  saved: true, accountId: 3, projectId: "hr", resource: "node-7", title: "Учёт отпусков",
  collaborative: true, created: true, link: "https://os.example/gatekeepers/mnemos?account=3&section=projects&project=hr&document=node-7",
};

function render(gadget: SavedGadget, onOpen?: () => void) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<GadgetWorkCard gadget={gadget} projectTitle="Кадры" onOpen={onOpen} />));
  const button = host.querySelector("button") as HTMLButtonElement;
  return { host, button };
}

describe("карточка гаджета в беседе", () => {
  it("совместный новый гаджет: название, метки, проект, подсказка и кнопка «Открыть»", () => {
    const onOpen = vi.fn();
    const { host, button } = render(saved, onOpen);
    expect(host.querySelector("h3")?.textContent).toBe("Учёт отпусков");
    expect(host.querySelector("article")?.getAttribute("aria-label")).toBe("Гаджет «Учёт отпусков»");
    const text = host.textContent ?? "";
    expect(text).toContain("Совместный");
    expect(text).not.toContain("Личный");
    expect(text).toContain("Личная версия");
    expect(text).toContain("Кадры");
    expect(text).toContain("новый файл");
    expect(text).toContain("Видите только вы, пока не опубликуете.");
    expect(text).toContain("Одни данные на всех, кому открыт файл.");
    // Внешний адрес в карточку не попадает: переход только через навигацию оболочки.
    expect(host.querySelector("a")).toBeNull();
    expect([...host.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Открыть"]);
    act(() => button.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("личный гаджет, новая версия, описание из манифеста и пометка о несохранённых исходниках", () => {
    const { host } = render({ ...saved, collaborative: false, created: false, description: "Заявки на отпуск и остаток дней", sourcesNote: "нет места" });
    const text = host.textContent ?? "";
    expect(text).toContain("Личный");
    expect(text).not.toContain("Совместный");
    expect(text).toContain("новая версия");
    expect(text).toContain("Заявки на отпуск и остаток дней");
    expect(text).not.toContain("У каждого, кому его дадут");
    expect(text).toContain("Исходники не сохранились");
  });

  it("приложение Mnemos не подключено — кнопка неактивна", () => {
    const { button } = render(saved);
    expect(button.disabled).toBe(true);
  });
});

describe("ссылки на гаджет в ответе агента", () => {
  const resources = new Set(["node-7"]);
  const url = saved.link!;

  it("отдельная строка со ссылкой пропадает, остальной текст не меняется", () => {
    const text = `Гаджет готов.\n\n[Открыть гаджет](${url})\n\nОпубликовать — кнопкой в шапке файла.`;
    expect(hideGadgetLinks(text, resources)).toBe("Гаджет готов.\n\n\nОпубликовать — кнопкой в шапке файла.");
  });

  it("ссылка в конце фразы и в пункте списка убирается вместе с двоеточием или тире", () => {
    expect(hideGadgetLinks(`Гаджет «Учёт отпусков» готов: [Открыть гаджет](${url}).`, resources)).toBe("Гаджет «Учёт отпусков» готов.");
    expect(hideGadgetLinks(`Сделал гаджет — [Открыть гаджет](${url})`, resources)).toBe("Сделал гаджет");
    expect(hideGadgetLinks(`- [Открыть гаджет](${url})\n- Правки — снова через меня`, resources)).toBe("- Правки — снова через меня");
    expect(hideGadgetLinks(`Откройте: ${url}`, resources)).toBe("Откройте");
  });

  it("ссылки на другие документы и другие гаджеты остаются", () => {
    const other = "[План](https://os.example/gatekeepers/mnemos?section=projects&project=hr&document=node-9)";
    expect(hideGadgetLinks(other, resources)).toBe(other);
    expect(hideGadgetLinks("[Сайт](https://example.com/?document=node-7)", resources)).toBe("[Сайт](https://example.com/?document=node-7)");
    expect(hideGadgetLinks(`[Открыть гаджет](${url})`, new Set())).toBe(`[Открыть гаджет](${url})`);
  });

  it("узлы берутся только из сохранённых результатов gadgetWork", () => {
    const messages = [
      { type: "message", toolCalls: [
        { toolName: "gadgetWork", toolCallId: "a", input: { task: "x" }, output: { projectTitle: "Кадры", steps: [], gadget: saved } },
        { toolName: "gadgetWork", toolCallId: "b", input: { task: "y" }, output: { projectTitle: "Кадры", steps: [], gadget: { saved: false, error: "нет сборки" } } },
        { toolName: "codeWork", toolCallId: "c", input: { task: "z", projectId: "hr" }, output: { projectTitle: "Кадры", steps: [] } },
      ] },
      { type: "changes" },
    ] as unknown as AiChatMessage[];
    expect([...savedGadgetResources(messages)]).toEqual(["node-7"]);
  });
});
