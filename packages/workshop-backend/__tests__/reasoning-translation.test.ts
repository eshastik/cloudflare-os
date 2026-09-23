import { describe, it, expect, vi } from "vitest";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import { isMostlyRussian, reasoningForDisplay } from "@gadgets/workshop-shared/reasoning";
import { translateReasoning, translateStoredReasoning, type ReasoningStore } from "../src/reasoning-translation";

const ENGLISH = "**Planning the search**\n\nI need to find where the config lives. Let me check `src/config.ts` first.";
const RUSSIAN = "**Планирую поиск**\n\nНужно найти, где лежит конфигурация. Сначала посмотрю `src/config.ts`.";

describe("язык размышлений", () => {
  it("русский текст узнаётся по доле кириллицы, код и пути не считаются", () => {
    expect(isMostlyRussian(RUSSIAN)).toBe(true);
    expect(isMostlyRussian(ENGLISH)).toBe(false);
    expect(isMostlyRussian("Смотрю `packages/workshop-backend/src/agent.ts` и https://example.com/some/path")).toBe(true);
    expect(isMostlyRussian("Проверяю, что делает runAgentLoopContinue в agent")).toBe(true);
    expect(isMostlyRussian("```ts\nconst x = 1;\n```")).toBe(true);
    expect(isMostlyRussian("")).toBe(true);
  });

  it("показ: перевод, русский исходник или ожидание перевода", () => {
    expect(reasoningForDisplay({})).toBeNull();
    expect(reasoningForDisplay({ reasoning: RUSSIAN })).toEqual({ text: RUSSIAN, translated: false });
    expect(reasoningForDisplay({ reasoning: ENGLISH })).toEqual({ pending: true, original: ENGLISH.trim() });
    expect(reasoningForDisplay({ reasoning: ENGLISH, reasoningTranslation: RUSSIAN })).toEqual({ text: RUSSIAN, translated: true });
  });
});

describe("перевод размышлений", () => {
  it("русское не переводится, английское уходит в модель, ответ не по-русски отбрасывается", async () => {
    const complete = vi.fn(async () => RUSSIAN);
    expect(await translateReasoning(complete, RUSSIAN)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(await translateReasoning(complete, ENGLISH)).toBe(RUSSIAN);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].prompt).toBe(ENGLISH);
    expect(await translateReasoning(async () => ENGLISH, ENGLISH)).toBeNull();
    expect(await translateReasoning(async () => "  ", ENGLISH)).toBeNull();
  });

  function store(initial: AiChatMessage[]) {
    const messages = new Map(initial.map((m) => [`${m.chatId}.${m.sequence}`, m]));
    const puts: AiChatMessage[] = [];
    const s: ReasoningStore = {
      get: (c, q) => messages.get(`${c}.${q}`),
      put: (m) => { puts.push(m); messages.set(`${m.chatId}.${m.sequence}`, m); },
      now: () => new Date(2026, 8, 24, 12, 0, 0),
    };
    return { s, messages, puts };
  }
  const author = { type: "ai", id: "m", name: "Модель" } as unknown as AiChatMessage["author"];
  const message = (reasoning: string): AiChatMessage => ({
    chatId: 1, sequence: 5, timestamp: new Date(2026, 8, 24, 11, 0, 0), author, type: "message", message: "Готово", reasoning,
  });

  it("перевод сохраняется в сообщении рядом с исходником и с новой отметкой времени", async () => {
    const { s, messages, puts } = store([message(ENGLISH)]);
    expect(await translateStoredReasoning(s, 1, 5, async () => RUSSIAN)).toBe(true);
    const saved = messages.get("1.5") as Extract<AiChatMessage, { type: "message" }>;
    expect(saved.reasoning).toBe(ENGLISH);
    expect(saved.reasoningTranslation).toBe(RUSSIAN);
    expect(saved.message).toBe("Готово");
    expect(saved.timestamp).toEqual(new Date(2026, 8, 24, 12, 0, 0));
    expect(puts).toHaveLength(1);
    // Повторный запуск не переводит уже переведённое.
    const again = vi.fn(async () => RUSSIAN);
    expect(await translateStoredReasoning(s, 1, 5, again)).toBe(false);
    expect(again).not.toHaveBeenCalled();
  });

  it("русские размышления и удалённая за время перевода беседа не трогаются", async () => {
    const ru = store([message(RUSSIAN)]);
    expect(await translateStoredReasoning(ru.s, 1, 5, async () => RUSSIAN)).toBe(false);
    expect(ru.puts).toHaveLength(0);

    const gone = store([message(ENGLISH)]);
    const complete = async () => { gone.messages.delete("1.5"); return RUSSIAN; };
    expect(await translateStoredReasoning(gone.s, 1, 5, complete)).toBe(false);
    expect(gone.puts).toHaveLength(0);
  });
});
