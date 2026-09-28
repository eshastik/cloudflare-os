import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import type { AppearancePreference } from "@gadgets/workshop-shared/accent-theme";
import { expect, it } from "vitest";

async function connect(): Promise<RpcStub<PublicApi>> {
  const response = await exports.default.fetch(new Request("https://workshop.invalid/api", { headers: { Upgrade: "websocket" } }));
  const socket = response.webSocket!;
  socket.accept();
  return newWebSocketRpcSession<PublicApi>(socket);
}

async function account(api: RpcStub<PublicApi>): Promise<{ name: string; token: string }> {
  const name = "look" + crypto.randomUUID().replaceAll("-", "");
  const token = await api.createAccount(name, name, new Uint8Array([1, 2, 3]));
  return { name, token: token! };
}

it("оформление хранится в аккаунте и видно из нового соединения того же человека, но не другого", async () => {
  using api = await connect();
  const alice = await account(api), bob = await account(api);
  {
    using session = await api.authenticate(alice.token);
    expect(await session.getAppearance()).toBeNull();
    await session.setAppearance({ accent: "plum", themeMode: "dark" });
  }
  // Новое соединение — как другой браузер: локального кэша нет, есть только аккаунт.
  using other = await connect();
  using again = await other.authenticate(alice.token);
  expect(await again.getAppearance()).toEqual({ accent: "plum", themeMode: "dark" });
  await again.setAppearance({ accent: null, themeMode: "system" });
  expect(await again.getAppearance()).toEqual({ accent: null, themeMode: "system" });
  using bobSession = await api.authenticate(bob.token);
  expect(await bobSession.getAppearance()).toBeNull();
});

// На соединении с браузером тип проверяет ещё и capnweb-validate; здесь проверяется второй барьер —
// сам объект пользователя, до которого значение может дойти и в обход этой проверки.
it("объект пользователя отвергает цвет вне палитры, произвольный CSS, неизвестную тему и лишние поля", async () => {
  using api = await connect();
  const alice = await account(api);
  await runInDurableObject(exports.UserDurableObject.getByName(alice.name), async instance => {
    await instance.setAppearance({ accent: "blue", themeMode: "light" });
    const bad: unknown[] = [
      { accent: "#ff0000", themeMode: "light" },
      { accent: "url(https://evil.example)", themeMode: null },
      { accent: "blue", themeMode: "sepia" },
      { accent: "blue", themeMode: "light", extra: "x" },
      { accent: "blue" },
      null,
      "blue",
    ];
    for (const value of bad) {
      await expect(instance.setAppearance(value as AppearancePreference)).rejects.toThrow("Недопустимое оформление");
    }
    expect(await instance.getAppearance()).toEqual({ accent: "blue", themeMode: "light" });
  });
});

it("испорченная запись в хранилище читается как пустая, а не отдаётся клиенту", async () => {
  using api = await connect();
  const alice = await account(api);
  await runInDurableObject(exports.UserDurableObject.getByName(alice.name), async instance => {
    instance["storage"].appearance.put({ accent: "javascript:alert(1)", themeMode: "dark" } as never);
  });
  using session = await api.authenticate(alice.token);
  expect(await session.getAppearance()).toBeNull();
});
