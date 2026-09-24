import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import type { UserDurableObject } from "../src/user.js";
import type { AdminSettings } from "../src/admin-settings.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv { TEST_USER: DurableObjectNamespace<UserDurableObject>; TEST_ADMIN_SETTINGS: DurableObjectNamespace<AdminSettings>; }
}
import { createTypedStorage, collection } from "@gadgets/typed-storage";
import { SharingManager, SharingStorage, CollaboratorRecord, ShareKeyRecord } from "../src/sharing.js";
import { findInvitees, matchDirectory, MAX_INVITEES } from "../src/user-directory.js";
import { makeMockStorage } from "./mock-storage.js";

const PEOPLE = [
  { id: "admin", name: "Александр Егоров" },
  { id: "nikolay@example.ru", name: "Николай Деревцов" },
  { id: "maria@example.ru", name: "Мария Соколова" },
  { id: "alex@example.ru", name: "alex" },
];
const ALIASES = new Map([["owner@example.ru", "admin"]]);

describe("справочник подсказок «Поделиться»", () => {
  it("ищет по началу имени, слова имени, имени входа и почты; лишних полей нет", () => {
    expect(matchDirectory(PEOPLE, "Ник", ALIASES, new Set())).toEqual([{ id: "nikolay@example.ru", name: "Николай Деревцов" }]);
    expect(matchDirectory(PEOPLE, "соко", ALIASES, new Set()).map(p => p.id)).toEqual(["maria@example.ru"]);
    expect(matchDirectory(PEOPLE, "owner@", ALIASES, new Set())).toEqual([{ id: "admin", name: "Александр Егоров", email: "owner@example.ru" }]);
    expect(matchDirectory(PEOPLE, "ale", ALIASES, new Set()).map(p => p.id)).toEqual(["alex@example.ru"]);
    expect(matchDirectory(PEOPLE, "дерев", ALIASES, new Set(["nikolay@example.ru"]))).toEqual([]);
    expect(matchDirectory(PEOPLE, "ова", ALIASES, new Set())).toEqual([]);
    expect(matchDirectory(PEOPLE, "  ", ALIASES, new Set())).toEqual([]);
  });

  it("не больше восьми", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `user${i}`, name: `Иван ${i}` }));
    expect(matchDirectory(many, "иван", new Map(), new Set())).toHaveLength(MAX_INVITEES);
  });
});

function manager() {
  const storage: SharingStorage = createTypedStorage(makeMockStorage(), {
    collections: {
      collaborators: collection<CollaboratorRecord>()({ primaryKey: (r: CollaboratorRecord) => r.profile.id }),
      shareKeys: collection<ShareKeyRecord>()({ primaryKey: "id", nonUniqueIndexes: { byAlias(r: ShareKeyRecord) { return r.alias ?? null; } } }),
    },
  });
  const mgr = new SharingManager(storage, "owner");
  mgr.addCollaborator({ caller: { profileId: "owner", isOwner: true }, profile: { type: "user", id: "helper", name: "helper" }, role: "use" });
  return mgr;
}

describe("право искать людей", () => {
  const search = () => vi.fn(async (_q: string, exclude: string[]) => PEOPLE.filter(p => !exclude.includes(p.id)).map(p => ({ ...p, secret: "x" })));
  it("владелец и участник видят подсказки без уже имеющих доступ и без лишних полей", async () => {
    const mgr = manager();
    for (const caller of [{ profileId: "owner", isOwner: true }, { profileId: "helper", isOwner: false }]) {
      const run = search();
      const found = await findInvitees({ query: "м", canShare: () => mgr.requireShareRole(caller), prohibited: false, existing: ["owner", "helper", "maria@example.ru"], search: run });
      expect(run).toHaveBeenCalledWith("м", ["owner", "helper", "maria@example.ru"]);
      expect(found.every(p => !("secret" in p))).toBe(true);
      expect(found.some(p => p.id === "maria@example.ru")).toBe(false);
    }
  });
  it("посторонний получает отказ, и справочник не читается", async () => {
    const mgr = manager(), run = search();
    await expect(findInvitees({ query: "м", canShare: () => mgr.requireShareRole({ profileId: "stranger", isOwner: false }), prohibited: false, existing: [], search: run }))
      .rejects.toThrow("permission");
    expect(run).not.toHaveBeenCalled();
  });
  it("беседа с личными данными и пустой или слишком длинный запрос ничего не ищут", async () => {
    const run = search();
    expect(await findInvitees({ query: "м", canShare: () => "build", prohibited: true, existing: [], search: run })).toEqual([]);
    expect(await findInvitees({ query: " ", canShare: () => "build", prohibited: false, existing: [], search: run })).toEqual([]);
    await expect(findInvitees({ query: "м".repeat(101), canShare: () => "build", prohibited: false, existing: [], search: run })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("вход вносит человека в справочник", () => {
  it("после входа и смены имени его находит поиск справочника", async () => {
    const users = env.TEST_USER;
    const directory = env.TEST_ADMIN_SETTINGS.getByName("");
    const user = users.get(users.idFromName("olga"));
    const token = await user.createAccount("olga", "Ольга Петрова", new Uint8Array(32).fill(3));
    await user.authenticate(token!);
    expect(await directory.findDirectoryUsers("пет", [])).toEqual([{ id: "olga", name: "Ольга Петрова" }]);
    expect(await directory.findDirectoryUsers("ol", ["olga"])).toEqual([]);
    await user.setOwnDisplayName("Ольга Иванова");
    expect(await directory.findDirectoryUsers("иван", [])).toEqual([{ id: "olga", name: "Ольга Иванова" }]);
  }, 30_000); // первый запуск объектов в общем прогоне бывает дольше пяти секунд
});
