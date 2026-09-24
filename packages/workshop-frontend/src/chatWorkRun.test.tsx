// @vitest-environment jsdom
// Ход работы с гаджетом: отметки «агент открыл гаджет» не рвут ход на отдельные строки,
// шаги кода сводятся в один ход с итогом.
import { describe, expect, it } from "vitest";
import type { AiChatMessage, AiToolCall } from "@gadgets/workshop-shared/api";
import { buildChatDisplayEntries } from "./ChatInterface";
import { buildWorkSteps, summarizeRun } from "./components/chat/toolDisplay";

const agent = { type: "agent", id: "a", name: "Помощник" } as const;
let seq = 0;
const at = (s: number) => new Date(Date.UTC(2026, 8, 25, 10, 0, s));
const step = (s: number, code: string): AiChatMessage => ({ chatId: 1, sequence: ++seq, timestamp: at(s), author: agent, type: "message", message: "",
  toolCalls: [{ toolCallId: `c${seq}`, toolName: "executeCode", input: { code }, output: "ok" } as AiToolCall] } as AiChatMessage);
const used = (s: number, withList = true): AiChatMessage => ({ chatId: 1, sequence: ++seq, timestamp: at(s), author: { type: "gadget", id: "g", name: "Документ" }, type: "useGadget",
  ...(withList ? { gadgets: [{ id: 7, title: "Коммерческое предложение для АТБанк", bindingName: "ATBANK_PROPOSAL", outputId: "document" }] } : {}) } as AiChatMessage);

describe("ход с гаджетом", () => {
  it("четыре шага кода и отметки гаджета — один ход, без строк «Использовано приложение»", () => {
    const messages: AiChatMessage[] = [
      { chatId: 1, sequence: ++seq, timestamp: at(0), author: { type: "user", id: "u", name: "Я" }, type: "message", message: "Обнови КП" } as AiChatMessage,
      step(5, "await env.ATBANK_PROPOSAL.getDocument()"), used(5),
      step(12, "await env.ATBANK_PROPOSAL.setDocument({blocks: []})"), used(12, false),
      step(20, "await env.ATBANK_PROPOSAL.getDocument()"), used(20),
      step(30, "await env.ATBANK_PROPOSAL.applyOperation({upserts: []})"), used(30),
    ];
    const entries = buildChatDisplayEntries(messages, new Map());
    expect(entries.map(entry => entry.type)).toEqual(["message", "workRun"]);
    const run = entries[1];
    if (run.type !== "workRun") throw new Error("нет хода");
    const group = run.toolCallGroups[0];
    expect(group.batches).toHaveLength(4);
    const { steps, code } = buildWorkSteps(group.batches!);
    expect(steps.map(s => s.label)).toEqual([
      "Прочитал документ «Коммерческое предложение для АТБанк»",
      "Изменил документ «Коммерческое предложение для АТБанк»",
      "Прочитал документ «Коммерческое предложение для АТБанк»",
      "Изменил документ «Коммерческое предложение для АТБанк»",
    ]);
    expect(summarizeRun(steps, code.length, group.finishedAt!.getTime() - group.startedAt!.getTime())).toBe("Готово за 30 с · 2 чтения документа, 2 правки документа");
  });
});
