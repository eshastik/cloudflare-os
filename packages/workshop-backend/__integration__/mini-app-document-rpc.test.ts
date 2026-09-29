// Документ беседы для Telegram Mini App (OverseerDurableObject.openMiniAppDocument): те же проверки,
// что при открытии беседы на сайте. Владелец и соавтор с правом правки — да; соавтор «только
// пользоваться», запрет общего доступа и неподтверждённое наблюдение за источниками — отказ.
import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { PublicApi } from "@gadgets/workshop-shared/api";
import { expect, it } from "vitest";

type Instance = {
  openMiniAppDocument(userId: string, profileId: string, gadgetId: number): Promise<{ info(): Promise<{ format: string }> }>;
  impl: {
    storage: { prohibitAllSharing: { put(v: boolean): void }; ownerOnlyObservations: { put(v: boolean): void };
      gadgets: { get(id: number): Record<string, unknown> | undefined; put(r: Record<string, unknown>): void } };
    ensureObserver: (...args: unknown[]) => Promise<void>;
  };
};

async function setup() {
  const response = await exports.default.fetch(new Request("https://workshop.invalid/api", { headers: { Upgrade: "websocket" } }));
  response.webSocket!.accept();
  const api = newWebSocketRpcSession<PublicApi>(response.webSocket!) as RpcStub<PublicApi>;
  const make = async (prefix: string) => {
    const name = prefix + crypto.randomUUID().replaceAll("-", "");
    const token = (await api.createAccount(name, name, new Uint8Array([1, 2, 3])))!;
    return { name, token, userId: exports.UserDurableObject.idFromName(name).toString() };
  };
  const owner = await make("own"), user = await make("use"), builder = await make("bld");
  const session = api.authenticate(owner.token);
  const overseer = session.newGadget();
  const id = (await overseer.getMetadata()).id;
  const gadget = overseer.createGadget("Отчёт");
  const gadgetId = await gadget.getId();
  expect(await overseer.addCollaborator(user.name, "use")).not.toBeNull();
  expect(await overseer.addCollaborator(builder.name, "build")).not.toBeNull();
  const stub = exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString(id));
  // Вывод становится документом (как у выводов формата «Документ»).
  await runInDurableObject(stub, (instance: Instance) => {
    const record = instance.impl.storage.gadgets.get(gadgetId)!;
    instance.impl.storage.gadgets.put({ ...record, output: { id: "document", noun: "Документ", plural: "Документы", icon: "fileText" } });
  });
  const openAs = (who: { userId: string; name: string }) =>
    runInDurableObject(stub, async (instance: Instance) => {
      try { return (await (await instance.openMiniAppDocument(who.userId, who.name, gadgetId)).info()).format; }
      catch (error) { return "отказ: " + (error as Error).message; }
    });
  return { api, stub, owner, user, builder, gadgetId, openAs };
}

it("владелец и соавтор с правом правки открывают документ; соавтор «только пользоваться» — отказ", async () => {
  const s = await setup();
  expect(await s.openAs(s.owner)).toBe("cloudflareos.document");
  expect(await s.openAs(s.builder)).toBe("cloudflareos.document");
  expect(await s.openAs(s.user)).toMatch(/^отказ: You don't have access/);
  const stranger = { userId: exports.UserDurableObject.idFromName("nobody-" + crypto.randomUUID()).toString(), name: "nobody" };
  expect(await s.openAs(stranger)).toMatch(/^отказ: You don't have access/);
});

it("запрет общего доступа или личные источники беседы — соавтору отказ, владельцу нет", async () => {
  for (const flag of ["prohibitAllSharing", "ownerOnlyObservations"] as const) {
    const s = await setup();
    await runInDurableObject(s.stub, (instance: Instance) => { instance.impl.storage[flag].put(true); });
    expect(await s.openAs(s.builder)).toMatch(/^отказ: You don't have access/);
    expect(await s.openAs(s.owner)).toBe("cloudflareos.document");
  }
});

it("наблюдение за источниками беседы не подтвердилось — отказ", async () => {
  const s = await setup();
  await runInDurableObject(s.stub, (instance: Instance) => {
    instance.impl.ensureObserver = async () => { throw new Error("Источник беседы вам недоступен"); };
  });
  expect(await s.openAs(s.owner)).toBe("отказ: Источник беседы вам недоступен");
  expect(await s.openAs(s.builder)).toBe("отказ: Источник беседы вам недоступен");
});

it("не документ — отказ", async () => {
  const s = await setup();
  await runInDurableObject(s.stub, (instance: Instance) => {
    const record = instance.impl.storage.gadgets.get(s.gadgetId)!;
    instance.impl.storage.gadgets.put({ ...record, output: undefined });
  });
  expect(await s.openAs(s.owner)).toMatch(/^отказ: This output is not a document/);
});
