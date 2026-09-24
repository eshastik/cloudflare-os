import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { AiChatAuthorInfo, AiChatMetadata } from "@gadgets/workshop-shared/api";
import type { SpendingEntry } from "@gadgets/workshop-shared/spending";
import { getModel } from "../src/ai-models.js";
import { completeText } from "../src/ai-invoke.js";
import { installationChatModel, installationQuickModel } from "../src/code-router.js";
import { transcribeChatVoice } from "../src/chat-voice.js";
import { modelSpend, providerCostFetch, spendingEntry, type ModelSpend } from "../src/spend-ledger.js";
import type { OverseerDurableObject } from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const INITIATOR: AiChatAuthorInfo = { type: "user", id: "user-1", name: "User" };
const OPENROUTER_ENV = { MNEMOS_STT_API_KEY: "sk-or", MNEMOS_STT_URL: "https://openrouter.ai/api/v1/audio/transcriptions", MNEMOS_STT_PROTOCOL: "openrouter", MNEMOS_CHAT_MODEL: "deepseek/deepseek-v4-flash-0731" };

function sse(...events: unknown[]): Response {
  const body = events.map(e => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

const chunk = (delta: object, finish: string | null = null) =>
  ({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
const usage = (cost: number) =>
  ({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [], usage: { prompt_tokens: 900, completion_tokens: 20, total_tokens: 920, cost } });

describe("Цена из ответа поставщика", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("читает usage.cost из потока и из обычного ответа, не меняя тела", async () => {
    let seen: number[] = [];
    const stream = providerCostFetch(async () => sse(chunk({ content: "a" }), usage(0.0123), usage(0.0123), "[DONE]"), usd => seen.push(usd));
    const text = await (await stream("https://openrouter.ai/api/v1/chat/completions")).text();
    expect(text).toContain("[DONE]");
    expect(seen).toEqual([0.0123]);
    seen = [];
    const json = providerCostFetch(async () => Response.json({ text: "ok", usage: { cost: 0.0042 } }), usd => seen.push(usd));
    expect(await (await json("https://openrouter.ai/api/v1/audio/transcriptions")).json()).toEqual({ text: "ok", usage: { cost: 0.0042 } });
    expect(seen).toEqual([0.0042]);
    seen = [];
    const responses = providerCostFetch(async () => sse({ type: "response.completed", response: { usage: { input_tokens: 5, cost: 0.5 } } }), usd => seen.push(usd));
    await (await responses("https://openrouter.ai/api/v1/responses")).text();
    expect(seen).toEqual([0.5]);
  });

  it("ход через OpenRouter несёт фактическую цену и просит её в запросе", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(await new Request(input as RequestInfo, init).text());
      return sse(chunk({ role: "assistant", content: "Привет" }), chunk({}, "stop"), usage(0.0123), "[DONE]");
    }));
    const handle = getModel({} as Cloudflare.Env, installationQuickModel(OPENROUTER_ENV)!, INITIATOR);
    let spent: ModelSpend | undefined;
    expect(await completeText(handle, { prompt: "hi", onSpend: s => { spent = s; } })).toBe("Привет");
    expect(JSON.parse(bodies[0]).usage).toEqual({ include: true });
    expect(handle.lastProviderCostUsd).toBe(0.0123);
    expect(spent).toMatchObject({ usd: 0.0123, estimated: false, model: "deepseek/deepseek-v4-flash-0731", outputTokens: 20 });
    expect(spendingEntry("id", "chat", "chat.reply", spent!, "p1").micro_usd).toBe("12300");
  });

  it("общая модель бесед установки тоже идёт в OpenRouter и считается", async () => {
    const chat = installationChatModel(OPENROUTER_ENV)!;
    const handle = getModel({} as Cloudflare.Env, chat.config, INITIATOR);
    const stream = await handle.stream(handle.model, { messages: [{ role: "user", content: "hi", timestamp: 0 }] },
      { fetch: (async () => sse({ type: "response.completed", response: { usage: { cost: 0.25 } } })) as typeof fetch, maxRetries: 0 });
    await stream.result();
    expect(handle.lastProviderCostUsd).toBe(0.25);
    expect(modelSpend(handle, undefined)).toMatchObject({ usd: 0.25, estimated: false });
  });

  it("без цены поставщика трата помечена оценкой", () => {
    const spend = modelSpend({ model: { id: "m", provider: "anthropic" } }, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.002 } });
    expect(spend).toMatchObject({ usd: 0.002, estimated: true, inputTokens: 1, outputTokens: 2 });
  });

  it("распознавание речи отдаёт цену OpenRouter в учёт", async () => {
    let spent: ModelSpend | undefined;
    const text = await transcribeChatVoice({ ...OPENROUTER_ENV, MNEMOS_STT_MODEL: "openai/whisper-large-v3" }, new TextEncoder().encode("audio"), "audio/webm",
      async () => Response.json({ text: "Проверка", usage: { cost: 0.0006 } }), s => { spent = s; });
    expect(text).toBe("Проверка");
    expect(spent).toMatchObject({ usd: 0.0006, estimated: false, provider: "openrouter", model: "openai/whisper-large-v3" });
  });
});

type OutboxItem = { id: string; userId: string; accountId?: number; entry: SpendingEntry; attempts: number };

describe("Очередь трат беседы", () => {
  it("пишет ответ беседы в очередь с проектом и отправляет через подключение человека; сбой не теряет трату", async () => {
    const stub = env.TEST_OVERSEER.getByName("spend-outbox");
    await runInDurableObject(stub, async (instance: OverseerDurableObject) => {
      const impl = (instance as unknown as { impl: {
        storage: { chatMeta: { put(meta: AiChatMetadata): void; get(id: number): AiChatMetadata | undefined }; spendOutbox: { list(): Iterable<OutboxItem> } };
        users: unknown;
        addChatMessages(chatId: number, author: AiChatAuthorInfo, messages: [], totalTokens?: number, logId?: string, route?: undefined, estimatedCost?: number, spend?: ModelSpend): void;
        recordModelSpend(chatId: number | undefined, operation: string, spend: ModelSpend): void;
        flushSpendOutbox(): Promise<void>;
      } }).impl;
      const sent: [SpendingEntry[], number | null][] = [];
      let fail = true;
      impl.users = { idFromString: (id: string) => id, get: () => ({ async recordOwnSpending(entries: SpendingEntry[], account: number | null) {
        if (fail) throw new Error("Mnemos недоступен");
        sent.push([entries, account]); return "sent";
      } }) };
      impl.storage.chatMeta.put({ id: 7, title: "Chat", started: new Date(0), lastActive: new Date(0),
        projectContext: { accountId: 3, projectId: "p1", title: "Сайт", creatorId: "creator-do", creatorProfileId: "u" } });
      const spend: ModelSpend = { usd: 0.000110292, estimated: false, provider: "openrouter", model: "deepseek/deepseek-v4-flash-0731", inputTokens: 900, outputTokens: 20 };
      impl.addChatMessages(7, { type: "agent", id: "m", name: "M" }, [], 920, undefined, undefined, spend.usd, spend);
      impl.recordModelSpend(7, "chat.title", { ...spend, usd: 0.00001, estimated: true });
      await impl.flushSpendOutbox();
      const pending = [...impl.storage.spendOutbox.list()];
      expect(pending).toHaveLength(2);
      expect(pending.every(i => i.attempts >= 1 && i.userId === "creator-do" && i.accountId === 3)).toBe(true);
      expect(impl.storage.chatMeta.get(7)?.totalCost).toBeCloseTo(0.000110292);
      fail = false;
      await impl.flushSpendOutbox();
      expect([...impl.storage.spendOutbox.list()]).toHaveLength(0);
      const entries = sent.flatMap(([e]) => e);
      expect(sent.every(([, account]) => account === 3)).toBe(true);
      const reply = entries.find(e => e.operation === "chat.reply")!;
      expect(reply).toMatchObject({ kind: "chat", micro_usd: "110", estimated: false, project_id: "p1", input_tokens: 900, output_tokens: 20 });
      expect(entries.find(e => e.operation === "chat.title")).toMatchObject({ kind: "service", micro_usd: "10", estimated: true });
    });
  });
});
