import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import { expect, it } from "vitest";
import { SECRETS_KEY_MISSING } from "../src/telegram/secret-box";

async function connect(): Promise<RpcStub<PublicApi>> {
  const response = await exports.default.fetch(new Request("https://workshop.invalid/api", { headers: { Upgrade: "websocket" } }));
  const socket = response.webSocket!;
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

async function account(api: RpcStub<PublicApi>): Promise<{ name: string; token: string }> {
  const name = "tg" + crypto.randomUUID().replaceAll("-", "");
  const token = await api.createAccount(name, name, new Uint8Array([1, 2, 3]));
  return { name, token: token! };
}

// В тестовой конфигурации ключа SHELL_SECRETS_KEY нет — как на установке, которую ещё не обновили.
it("без ключа шифрования экран видит «недоступно», а подключение отказывает понятной ошибкой", async () => {
  using api = await connect();
  const alice = await account(api);
  using session = await api.authenticate(alice.token);
  expect(await session.getTelegramBot()).toEqual({ status: "unavailable", reason: "no_key" });
  const refused = await Promise.resolve(session.connectTelegramBot("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ")).then(() => null, (error: Error) => error);
  expect(refused?.message).toBe(SECRETS_KEY_MISSING);
  expect(await session.disconnectTelegramBot()).toEqual({ webhookRemoved: true });
});

it("вебхук: чужой или испорченный номер объекта — 404, неподключённый объект — 404", async () => {
  for (const path of ["/api/telegram/", "/api/telegram/zzz", "/api/telegram/" + "0".repeat(64), "/api/telegram/" + "a".repeat(64) + "/x"]) {
    const response = await exports.default.fetch(new Request("https://workshop.invalid" + path, { method: "POST", body: "{}" }));
    expect(response.status, path).toBe(404);
  }
  const id = exports.TelegramPersonalBot.idFromName("user:nobody");
  const response = await exports.default.fetch(new Request("https://workshop.invalid/api/telegram/" + id.toString(), {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "x".repeat(43) }, body: "{}" }));
  expect(response.status).toBe(404);
});

it("запись бота видна только своему пользователю: объект выбирается по имени вошедшего", async () => {
  using api = await connect();
  const alice = await account(api), bob = await account(api);
  // Подкладываем Алисе запись напрямую: сеть Telegram в тесте недоступна.
  await runInDurableObject(exports.TelegramPersonalBot.getByName("user:" + alice.name), async (_instance, state) => {
    state.storage.kv.put("bot", {
      owner: alice.name, mnemos: null, bot: { id: "123456789", username: "alice_helper_bot", title: "Помощник" },
      token: { v: 1, iv: "AAAAAAAAAAAAAAAA", data: "AAAA" }, secretSha256: "0".repeat(64),
      pairing: null, telegramOwner: { id: 1, name: "Алиса", username: null }, connectedAt: 5, createdAt: 5, seen: [],
    });
  });
  using aliceSession = await api.authenticate(alice.token);
  expect(await aliceSession.getTelegramBot()).toMatchObject({ status: "connected", bot: { username: "alice_helper_bot" } });
  using bobSession = await api.authenticate(bob.token);
  expect(await bobSession.getTelegramBot()).toEqual({ status: "unavailable", reason: "no_key" });
  // Отключение без ключа: вебхук снять нечем, но запись стёрта.
  expect(await aliceSession.disconnectTelegramBot()).toEqual({ webhookRemoved: false });
  expect(await aliceSession.getTelegramBot()).toEqual({ status: "unavailable", reason: "no_key" });
});

it("один бот — у одного пользователя: занятость держится до освобождения владельцем", async () => {
  const claim = exports.TelegramBotClaim.getByName("claim-test-" + crypto.randomUUID());
  expect(await claim.claim("alice")).toBe(true);
  expect(await claim.claim("alice")).toBe(true);
  expect(await claim.claim("bob")).toBe(false);
  await claim.release("bob");
  expect(await claim.claim("bob")).toBe(false);
  await claim.release("alice");
  expect(await claim.claim("bob")).toBe(true);
});
