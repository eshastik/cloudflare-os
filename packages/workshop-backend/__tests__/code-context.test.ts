import { describe, expect, it } from "vitest";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import { buildCodeContextPack, codeWorkBrief, openQuestions, squeeze, CONTEXT_PACK_HEADER } from "../src/code-context";
import { codeWorkToolsAvailable, formatCodeWorkPrompt } from "../src/agent";

const msg = (sequence: number, author: "user" | "agent", message: string): AiChatMessage =>
  ({chatId: 1, sequence, timestamp: new Date(0), author: {type: author, id: author, name: "Анна"}, type: "message", message} as AiChatMessage);
const bytes = (s: string) => new TextEncoder().encode(s).length;
const work = {accountId: 1, projectId: "p", projectTitle: "Сайт", taskId: "t", state: "idle" as const, foreground: true, cursor: 1,
  summary: "Поправил форму входа. Оставить старую кнопку?", changedFiles: [{path: "src/login.ts", status: "modified" as const}]};

describe("пакет контекста беседы", () => {
  it("объём не больше лимита: старые реплики опускаются первыми, новые остаются", () => {
    const messages = Array.from({length: 40}, (_, i) => msg(i + 1, i % 2 ? "agent" : "user", `реплика ${i + 1} ${"ж".repeat(1000)}`));
    const pack = buildCodeContextPack({messages, projects: []});
    expect(bytes(pack)).toBeLessThanOrEqual(12_000);
    expect(pack.startsWith(CONTEXT_PACK_HEADER)).toBe(true);
    expect(pack).toContain("реплика 40 ");
    expect(pack).not.toContain("реплика 1 ");
    expect(pack).toMatch(/ранние реплики опущены: \d+/);
  });

  it("длинная реплика сжимается до начала и конца", () => {
    const long = `начало ${"a".repeat(5000)} конец`;
    const short = squeeze(long, 200);
    expect(short.length).toBeLessThan(260);
    expect(short.startsWith("начало")).toBe(true);
    expect(short.endsWith("конец")).toBe(true);
  });
});

describe("живая сводка работы с кодом", () => {
  it("сводка: проект, сделанное, изменённые файлы, открытые вопросы", () => {
    const brief = codeWorkBrief(work);
    expect(brief).toContain("«Сайт»");
    expect(brief).toContain("Поправил форму входа");
    expect(brief).toContain("src/login.ts");
    expect(brief).toContain("Открытые вопросы: Оставить старую кнопку?");
    expect(openQuestions("Готово.\n- Нужен ли тёмный режим?")).toEqual(["Нужен ли тёмный режим?"]);
  });

  it("попадает в подсказку агента беседы только пока работа жива", () => {
    const brief = codeWorkBrief(work);
    const alive = formatCodeWorkPrompt({projects: [], active: {projectTitle: "Сайт", alive: true, brief}, mode: "auto", hasCodeProject: true});
    expect(alive).toContain("Сводка работы с кодом");
    expect(alive).toContain("src/login.ts");
    const done = formatCodeWorkPrompt({projects: [], active: {projectTitle: "Сайт", alive: false, brief}, mode: "auto", hasCodeProject: true});
    expect(done).not.toContain("Сводка работы с кодом");
    expect(done).not.toContain("src/login.ts");
  });
});

describe("переключатель «Код» в подсказке и инструментах агента беседы", () => {
  it("«Выкл» — нет codeWork/codeAsk и подсказка, как включить", () => {
    const off = {projects: [], mode: "off" as const, hasCodeProject: true};
    expect(codeWorkToolsAvailable(off)).toBe(false);
    expect(formatCodeWorkPrompt(off)).toContain("«Код: Выкл»");
    expect(codeWorkToolsAvailable({projects: [], mode: "auto"})).toBe(true);
    expect(codeWorkToolsAvailable({projects: [], mode: "on"})).toBe(true);
    expect(codeWorkToolsAvailable(null)).toBe(false);
  });

  it("«Вкл» без проекта с кодом — агент беседы просит подключить проект", () => {
    expect(formatCodeWorkPrompt({projects: [], mode: "on", hasCodeProject: false})).toContain("попроси подключить проект с кодом");
  });
});
