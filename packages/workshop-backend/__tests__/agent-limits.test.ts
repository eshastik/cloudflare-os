import { describe, it, expect } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { runAgentLoopContinue, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AGENT_STEP_LIMIT_CODE } from "@gadgets/workshop-shared/api";
import {
  AGENT_STEP_LIMIT, CONTINUE_AFTER_STEP_LIMIT_TEXT, READ_PAGE_CHARS, READ_PAGE_LINES, StepBudget,
  canContinueAfterStepLimit, finalStepInstruction, limitCodeOutput, pageFileText, pageWebBody, stepLimitNotice, stepLimitPrepareNextTurn,
} from "../src/agent-limits";

const model = {
  id: "fake", name: "fake", api: "fake-api", provider: "fake", baseUrl: "", reasoning: false,
  input: ["text"], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
  contextWindow: 100000, maxTokens: 1000,
} as any;

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant", content, api: "fake-api", provider: "fake", model: "fake",
    usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
    stopReason, timestamp: 0,
  } as AssistantMessage;
}

// Модель, которая всегда хочет ещё один вызов инструмента, пока в подсказке нет просьбы о итоге.
function endlessWorker(prompts: string[]) {
  return (_model: unknown, context: Context) => {
    prompts.push(context.systemPrompt ?? "");
    let stream = createAssistantMessageEventStream();
    let finalStep = (context.systemPrompt ?? "").includes("Последний шаг");
    let message = finalStep
      ? assistant([{type: "text", text: "Сделано: прочитал 99 файлов. Осталось: свести итог."}], "stop")
      : assistant([{type: "toolCall", id: `c${prompts.length}`, name: "look", arguments: {}}], "toolUse");
    queueMicrotask(() => stream.push({type: "done", reason: message.stopReason as "stop", message}));
    return stream;
  };
}

const lookTool: AgentTool = {
  name: "look", label: "look", description: "look", parameters: Type.Object({}),
  execute: async () => ({content: [{type: "text", text: "ok"}], details: {}}),
};

describe("предел шагов хода", () => {
  it("по умолчанию 100 шагов; бюджет говорит, когда следующий шаг последний", () => {
    expect(AGENT_STEP_LIMIT).toBe(100);
    const budget = new StepBudget(3);
    expect(budget.finishStep()).toBe(false);
    expect(budget.finishStep()).toBe(true);
    expect(budget.exhausted).toBe(false);
    expect(budget.finishStep()).toBe(false);
    expect(budget.exhausted).toBe(true);
    expect(() => new StepBudget(0)).toThrow();
  });

  it("цикл агента делает ровно 100 запросов, последний — с просьбой подвести итог", async () => {
    const prompts: string[] = [];
    const budget = new StepBudget();
    const messages = await runAgentLoopContinue(
      {systemPrompt: "base", messages: [{role: "user", content: "сделай", timestamp: 0}], tools: [lookTool]},
      {
        model, convertToLlm: (m) => m as any, toolExecution: "sequential",
        prepareNextTurn: stepLimitPrepareNextTurn(budget, true),
        shouldStopAfterTurn: () => budget.exhausted,
      },
      async () => {}, undefined, endlessWorker(prompts) as any);

    expect(prompts).toHaveLength(100);
    expect(prompts.slice(0, 99).every(p => p === "base")).toBe(true);
    expect(prompts[99]).toContain(finalStepInstruction(100));
    expect(budget.exhausted).toBe(true);
    const last = messages.at(-1) as AssistantMessage;
    expect(last.role).toBe("assistant");
    expect(last.content[0]).toMatchObject({type: "text", text: expect.stringContaining("Осталось")});
  });

  it("без итога (саб-агент, колбэк) подсказка не меняется, но предел тот же", async () => {
    const prompts: string[] = [];
    const budget = new StepBudget(5);
    await runAgentLoopContinue(
      {systemPrompt: "base", messages: [{role: "user", content: "сделай", timestamp: 0}], tools: [lookTool]},
      {
        model, convertToLlm: (m) => m as any, toolExecution: "sequential",
        prepareNextTurn: stepLimitPrepareNextTurn(budget, false),
        shouldStopAfterTurn: () => budget.exhausted,
      },
      async () => {}, undefined, endlessWorker(prompts) as any);
    expect(prompts).toEqual(["base", "base", "base", "base", "base"]);
  });

  it("«Продолжить» доступно только после отметки о пределе шагов", () => {
    expect(canContinueAfterStepLimit({type: "error", code: AGENT_STEP_LIMIT_CODE})).toBe(true);
    expect(canContinueAfterStepLimit({type: "error"})).toBe(false);
    expect(canContinueAfterStepLimit({type: "error", code: "usage_limit"})).toBe(false);
    expect(canContinueAfterStepLimit({type: "message"})).toBe(false);
    expect(canContinueAfterStepLimit(undefined)).toBe(false);
    expect(CONTINUE_AFTER_STEP_LIMIT_TEXT).toContain("Не повторяй уже сделанное");
  });

  it("отметка в беседе и просьба об итоге — по-русски и с «Продолжить»", () => {
    expect(stepLimitNotice(100)).toBe("Агент сделал 100 шагов и остановился. Нажмите «Продолжить», чтобы он доделал работу.");
    expect(finalStepInstruction(100)).toContain("Что осталось сделать");
    expect(finalStepInstruction(100)).toContain("«Продолжить»");
  });
});

describe("чтение файла частями", () => {
  it("небольшой файл без offset/limit отдаётся как есть, без пометок", () => {
    const text = "a\nb\nc";
    expect(pageFileText(text)).toBe(text);
  });

  it("большой файл отдаётся по 2000 строк с пометкой, откуда читать дальше", () => {
    const lines = Array.from({length: 4500}, (_, i) => `строка ${i + 1}`);
    const text = lines.join("\n");
    const first = pageFileText(text);
    expect(first.startsWith("строка 1\n")).toBe(true);
    expect(first).toContain(`строка ${READ_PAGE_LINES}\n\n[Показаны строки 1–2000 из 4500. Продолжение: readFile с offset=2001.]`);
    expect(first).not.toContain("строка 2001");

    const second = pageFileText(text, 2001);
    expect(second.startsWith("строка 2001\n")).toBe(true);
    expect(second).toContain("[Показаны строки 2001–4000 из 4500. Продолжение: readFile с offset=4001.]");

    const last = pageFileText(text, 4001);
    expect(last).toContain("строка 4500\n\n[Показаны строки 4001–4500 из 4500. Это конец файла.]");

    expect(pageFileText(text, 10, 3)).toBe("строка 10\nстрока 11\nстрока 12\n\n[Показаны строки 10–12 из 4500. Продолжение: readFile с offset=13.]");
    expect(pageFileText(text, 5000)).toContain("строки с 5000 нет");
  });

  it("длинные строки режут часть по объёму, а не только по числу строк", () => {
    const line = "я".repeat(30_000);
    const text = [line, line, line, line, line].join("\n");
    const first = pageFileText(text);
    expect(first).toContain("[Показаны строки 1–3 из 5. Продолжение: readFile с offset=4.]");
    expect(first.length).toBeLessThan(READ_PAGE_CHARS + 200);

    const huge = "x".repeat(READ_PAGE_CHARS * 2);
    const cut = pageFileText(`${huge}\nхвост`);
    expect(cut).toContain(`[Строка 1 длиннее ${READ_PAGE_CHARS} символов, показано её начало. Следующая строка: offset=2.]`);
  });
});

describe("вывод кода и веб-страницы частями", () => {
  it("короткий вывод кода не меняется, длинный обрезается с пометкой и подсказкой", () => {
    expect(limitCodeOutput("готово")).toBe("готово");
    const out = limitCodeOutput("ф".repeat(250), 100);
    expect(out.startsWith("ф".repeat(100) + "\n\n[Вывод обрезан: показаны первые 100 из 250 символов.")).toBe(true);
    expect(out).toContain("text.slice(100, 200)");
  });

  it("тело ответа отдаётся частями с offset продолжения", () => {
    const body = "0123456789";
    expect(pageWebBody(body, undefined, 20)).toEqual({body});
    expect(pageWebBody(body, undefined, 4)).toEqual({
      body: "0123", note: "[Показаны символы 0–4 из 10. Продолжение: webFetch с тем же url и offset=4.]",
    });
    expect(pageWebBody(body, 8, 4)).toEqual({
      body: "89", note: "[Показаны символы 8–10 из 10. Это конец ответа.]",
    });
    expect(pageWebBody(body, 50, 4).note).toContain("ничего нет");
  });
});
