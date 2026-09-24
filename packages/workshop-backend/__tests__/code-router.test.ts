import { describe, expect, it } from "vitest";
import { askJev, codeRouteState, installationOpenRouterKey, JEV_URL, parseJevAnswer, type CodeRouteContext } from "../src/code-router";

const context: CodeRouteContext = {
  message: "а теперь запусти тесты",
  work: {projectTitle: "Сайт", topic: "Поправил форму входа"},
  lastReplyByCode: true,
  lastAgentReply: "Готово: форма входа проверяет пустой пароль. " + "x".repeat(900),
  codeProjects: ["Сайт"],
};

const answer = (choice: string, confidence: number, cost = 0.00002) =>
  ({answers: {route: {type: "choice", choice, probabilities: {code: confidence, chat: 1 - confidence}, confidence}}, usage: {cost}});

describe("маршрутизатор Jev", () => {
  it("разбирает ответ System One: выбор, уверенность, стоимость", () => {
    expect(parseJevAnswer(answer("code", 1))).toEqual({route: "code", confidence: 1, cost: 0.00002});
    expect(parseJevAnswer({answers: {route: {choice: "chat", probabilities: {chat: 0.7}}}})).toEqual({route: "chat", confidence: 0.7});
    expect(parseJevAnswer({answers: {route: {choice: "maybe", confidence: 1}}})).toBeNull();
    expect(parseJevAnswer({answers: {}})).toBeNull();
    expect(parseJevAnswer(null)).toBeNull();
  });

  it("state несёт сообщение и обстановку беседы; длинная реплика агента сжата", () => {
    const state = codeRouteState(context);
    expect(state).toContain("«а теперь запусти тесты»");
    expect(state).toContain("идёт работа с кодом проекта «Сайт»");
    expect(state).toContain("Поправил форму входа");
    expect(state).toContain("Проекты беседы с кодом: «Сайт»");
    expect(state).toContain("Предыдущий ответ дал агент кода");
    expect(state.length).toBeLessThan(1200);
    expect(codeRouteState({message: "привет", lastReplyByCode: false, codeProjects: []})).toContain("В беседе нет проекта с кодом");
  });

  it("запрос: адрес System One, модель jev-1.13, ключ в заголовке, вопрос route с критериями code и chat", async () => {
    let seen: {url: string; init: RequestInit} | undefined;
    const result = await askJev({apiKey: "sk-test", context, fetcher: async (url, init) => {
      seen = {url, init};
      return new Response(JSON.stringify(answer("code", 0.95)));
    }});
    expect(result).toEqual({ok: true, decision: {route: "code", confidence: 0.95, cost: 0.00002}});
    expect(seen!.url).toBe(JEV_URL);
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.model).toBe("jev-1.13");
    expect(body.state).toBe(codeRouteState(context));
    expect(body.questions.route.type).toBe("choice");
    expect(Object.keys(body.questions.route.criteria)).toEqual(["code", "chat"]);
  });

  it("срок, ошибка сети, плохой ответ — не бросает, а возвращает код ошибки без ключа", async () => {
    const hang = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    });
    expect(await askJev({apiKey: "sk-secret", context, fetcher: hang, timeoutMs: 5})).toEqual({ok: false, error: "timeout"});
    expect(await askJev({apiKey: "sk-secret", context, fetcher: async () => { throw new Error("sk-secret leaked?"); }}))
      .toEqual({ok: false, error: "network"});
    expect(await askJev({apiKey: "sk-secret", context, fetcher: async () => new Response("no", {status: 401})}))
      .toEqual({ok: false, error: "http_401"});
    expect(await askJev({apiKey: "sk-secret", context, fetcher: async () => new Response("{}")}))
      .toEqual({ok: false, error: "bad_answer"});
  });

  it("ключ OpenRouter установки — ключ распознавания речи, только если оно идёт через OpenRouter", () => {
    expect(installationOpenRouterKey({MNEMOS_STT_API_KEY: "k", MNEMOS_STT_PROTOCOL: "openrouter"})).toBe("k");
    expect(installationOpenRouterKey({MNEMOS_STT_API_KEY: "k", MNEMOS_STT_URL: "https://openrouter.ai/api/v1/audio"})).toBe("k");
    expect(installationOpenRouterKey({MNEMOS_STT_API_KEY: "k", MNEMOS_STT_URL: "https://speech.example/v1"})).toBeUndefined();
    expect(installationOpenRouterKey({})).toBeUndefined();
  });
});
