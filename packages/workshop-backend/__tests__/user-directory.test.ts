import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
// Импорт cloudflare:test загружает главный воркер (все объекты) при загрузке файла. Без него
// загрузка случалась при первом вызове объекта внутри теста и на занятой машине съедала весь срок
// теста (4–10 с локально, больше 30 с в CI).
import { runInDurableObject } from "cloudflare:test";
import type { UserDurableObject } from "../src/user.js";
import type { AdminSettings } from "../src/admin-settings.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv { TEST_USER: DurableObjectNamespace<UserDurableObject>; TEST_ADMIN_SETTINGS: DurableObjectNamespace<AdminSettings>; }
}
import { createTypedStorage, collection } from "@gadgets/typed-storage";
import { SharingManager, SharingStorage, CollaboratorRecord, ShareKeyRecord } from "../src/sharing.js";
import { findInvitees, matchDirectory, MAX_INVITEES, notYetSignedInProfile, principalsForUsers, rankInvitees } from "../src/user-directory.js";
import { collectMnemosPeople, mnemosAccountOwner } from "../src/mnemos-people.js";
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

// Запись в справочник идёт в фоне: ждём её опросом с коротким сроком.
const POLL = { timeout: 2_000, interval: 10 };

type DirectoryFake = { getByName(name: string): { recordDirectoryUser(entry: unknown): Promise<void> } };

describe("вход вносит человека в справочник", () => {
  it("после входа и смены имени его находит поиск справочника", async () => {
    const users = env.TEST_USER;
    const directory = env.TEST_ADMIN_SETTINGS.getByName("");
    const user = users.get(users.idFromName("olga"));
    const token = await user.createAccount("olga", "Ольга Петрова", new Uint8Array(32).fill(3));
    await user.authenticate(token!);
    await expect.poll(() => directory.findDirectoryUsers("пет", []), POLL).toEqual([{ id: "olga", name: "Ольга Петрова" }]);
    expect(await directory.findDirectoryUsers("ol", ["olga"])).toEqual([]);
    await user.setOwnDisplayName("Ольга Иванова");
    await expect.poll(() => directory.findDirectoryUsers("иван", []), POLL).toEqual([{ id: "olga", name: "Ольга Иванова" }]);
  });

  it("зависший справочник не задерживает ни вход, ни смену имени", async () => {
    const user = env.TEST_USER.getByName("stuck");
    const token = await user.createAccount("stuck", "Зависший", new Uint8Array(32).fill(4));
    let calls = 0;
    let release: (() => void) | undefined;
    await runInDurableObject(user, instance => {
      (instance as unknown as { adminSettings: DirectoryFake }).adminSettings = {
        getByName: () => ({ recordDirectoryUser: () => { calls++; return new Promise<void>(resolve => { release = resolve; }); } }),
      };
    });
    // Срок записи по умолчанию — секунды; вход и смена имени возвращаются, пока запись висит.
    await user.authenticate(token!);
    await user.setOwnDisplayName("Зависший снова");
    await expect.poll(() => calls, POLL).toBe(1);
    // Отпускаем из контекста объекта: продолжение записи трогает его хранилище.
    await runInDurableObject(user, () => { release!(); });
    await expect.poll(() => calls, POLL).toBe(2);
    await runInDurableObject(user, () => { release!(); });
  });

  it("запись, не уложившаяся в срок, не держит очередь следующих", async () => {
    const user = env.TEST_USER.getByName("slow");
    const token = await user.createAccount("slow", "Медленный", new Uint8Array(32).fill(5));
    let calls = 0;
    await runInDurableObject(user, instance => {
      const fields = instance as unknown as { adminSettings: DirectoryFake; directoryWriteTimeoutMs: number };
      fields.directoryWriteTimeoutMs = 20;
      fields.adminSettings = { getByName: () => ({ recordDirectoryUser: () => { calls++; return new Promise<void>(() => {}); } }) };
    });
    await user.authenticate(token!);
    await user.setOwnDisplayName("Медленный снова");
    // Обе записи не удались по сроку: отметка не поставлена, следующий вход попробует снова.
    await expect.poll(() => calls, POLL).toBe(2);
    await user.authenticate(token!);
    await expect.poll(() => calls, POLL).toBe(3);
  });
});

// ---- Люди Mnemos как первый источник подсказок ----

const TENANT = "t1";
const OWNER = { tenant: TENANT, principal: "p-owner" };
const UNITS = [
  { org_unit_id: "u1", name: "Бухгалтерия", members: [
    { principal_id: "p-olga", display_name: "Ольга Никонова", is_head: false },
    { principal_id: "p-owner", display_name: "Александр Егоров", is_head: true },
  ] },
  { org_unit_id: "u2", name: "Продажи", members: [
    { principal_id: "p-nina", display_name: "Нина Петрова", is_head: true },
    { principal_id: "p-gone", display_name: "Уволенный", is_head: false },
  ] },
];
const adminUi = {
  listPeople: async () => ({ users: [
    { userName: "p-owner", externalId: "x", displayName: "Александр Егоров", active: true },
    { userName: "p-olga", externalId: "x", displayName: "Ольга Никонова", active: true },
    { userName: "p-nina", externalId: "x", displayName: "Нина Петрова", active: true },
    { userName: "p-nikita", externalId: "x", displayName: "Никита Орлов", active: true },
    { userName: "p-gone", externalId: "x", displayName: "Уволенный", active: false },
  ] }),
  listOrgUnits: async () => UNITS,
  listInvitations: async () => [
    { status: "accepted", email: "Olga@Example.ru", accepted_by: "p-olga" },
    { status: "accepted", email: "nina@example.ru", accepted_by: "p-nina" },
    { status: "open", email: "new@example.ru" },
  ],
};
// Сотрудник видит только свой отдел, перечень людей и почты Mnemos ему не отдаёт.
const employeeUi = {
  listPeople: async () => { throw new Error("403"); },
  listOrgUnits: async () => [UNITS[0]],
  listInvitations: async () => [],
};

describe("люди Mnemos для подсказок", () => {
  it("администратору — все действующие люди с отделами и почтами из принятых приглашений, без него самого", async () => {
    const people = await collectMnemosPeople(adminUi, OWNER);
    expect(people.manager).toBe(true);
    expect(people.people).toEqual([
      { principal: "p-olga", name: "Ольга Никонова", departments: ["Бухгалтерия"], email: "olga@example.ru" },
      { principal: "p-nina", name: "Нина Петрова", departments: ["Продажи"], email: "nina@example.ru" },
      { principal: "p-nikita", name: "Никита Орлов", departments: [] },
    ]);
  });

  it("сотруднику — люди его отделов без почт", async () => {
    const people = await collectMnemosPeople(employeeUi, OWNER);
    expect(people.manager).toBe(false);
    expect(people.people).toEqual([{ principal: "p-olga", name: "Ольга Никонова", departments: ["Бухгалтерия"] }]);
  });

  it("принципал подключения берётся из его uniqueName", () => {
    expect(mnemosAccountOwner(JSON.stringify(["t1", "p1"]))).toEqual({ tenant: "t1", principal: "p1" });
    expect(mnemosAccountOwner(JSON.stringify(["https://m.example", "t1", "p1"]))).toEqual({ tenant: "t1", principal: "p1" });
    expect(mnemosAccountOwner("owner@example.ru")).toBeNull();
    expect(mnemosAccountOwner(undefined)).toBeNull();
  });
});

describe("подсказки из Mnemos и справочника", () => {
  const rank = (query: string, mnemos: Awaited<ReturnType<typeof collectMnemosPeople>> | null,
    directory: { id: string; name: string; mnemos?: { tenant: string; principal: string } }[] = [], exclude: string[] = []) =>
    rankInvitees({ query, directory, aliases: ALIASES, mnemos, exclude: new Set(exclude) });

  it("при пустом справочнике подсказки приходят из людей Mnemos; не на что пригласить — не предлагается", async () => {
    const mnemos = await collectMnemosPeople(adminUi, OWNER);
    // Никита есть в Mnemos, но почты нет и в оболочку он не входил: пригласить его не на что.
    expect(rank("ни", mnemos)).toEqual([
      { id: "nina@example.ru", name: "Нина Петрова", email: "nina@example.ru", department: "Продажи" },
      { id: "olga@example.ru", name: "Ольга Никонова", email: "olga@example.ru", department: "Бухгалтерия" },
    ]);
    expect(rank("оль", mnemos, [], ["olga@example.ru"])).toEqual([]);
  });

  it("запись справочника и человек Mnemos склеиваются по почте и по принципалу; id — имя входа", async () => {
    const mnemos = await collectMnemosPeople(adminUi, OWNER);
    const directory = [
      { id: "olga@example.ru", name: "olga" },                                        // по почте
      { id: "nikita_o", name: "nikita", mnemos: { tenant: TENANT, principal: "p-nikita" } },  // по принципалу
      { id: "stranger", name: "Никифор", mnemos: { tenant: "other", principal: "p-nina" } },  // чужая организация
    ];
    const found = rank("ни", mnemos, directory);
    // Сначала совпадения по началу имени (по алфавиту), затем по слову имени.
    expect(found.map(p => p.id)).toEqual(["nikita_o", "stranger", "nina@example.ru", "olga@example.ru"]);
    expect(found.find(p => p.id === "nikita_o")).toEqual({ id: "nikita_o", name: "Никита Орлов" });
    expect(new Set(found.map(p => p.id)).size).toBe(found.length);
    // Имя из справочника тоже находит склеенного человека.
    expect(rank("olga", mnemos, directory).map(p => p.id)).toEqual(["olga@example.ru"]);
  });

  it("привязка LOGIN_ALIASES: подсказка ведёт в существующую учётную запись, дубля нет", async () => {
    const mnemos = { tenant: TENANT, self: "p-x", manager: true, people: [{ principal: "p-owner", name: "Александр Егоров", departments: ["Бухгалтерия"], email: "owner@example.ru" }] };
    expect(rank("алекс", mnemos, [{ id: "admin", name: "Администратор" }])).toEqual([
      { id: "admin", name: "Александр Егоров", email: "owner@example.ru", department: "Бухгалтерия" },
    ]);
  });

  it("обычный сотрудник не видит почт: ни из Mnemos, ни из справочника", async () => {
    const mnemos = await collectMnemosPeople(employeeUi, OWNER);
    const directory = [{ id: "olga@example.ru", name: "olga", mnemos: { tenant: TENANT, principal: "p-olga" } }, { id: "maria@example.ru", name: "Мария Соколова" }];
    const found = [...rank("оль", mnemos, directory), ...rank("мар", mnemos, directory), ...rank("maria@", mnemos, directory)];
    expect(found).toEqual([
      { id: "olga@example.ru", name: "Ольга Никонова", department: "Бухгалтерия" },
      { id: "maria@example.ru", name: "Мария Соколова" },
      { id: "maria@example.ru", name: "Мария Соколова" },
    ]);
    expect(found.some(p => "email" in p)).toBe(false);
    // Без подключения Mnemos почт в подсказках тоже нет.
    expect(rank("мар", null, directory)).toEqual([{ id: "maria@example.ru", name: "Мария Соколова" }]);
  });
});

describe("приглашение ещё не входившего", () => {
  it("принимается только почта сотрудника, которую отдал Mnemos, и только как будущее имя входа", async () => {
    const mnemos = await collectMnemosPeople(adminUi, OWNER);
    expect(notYetSignedInProfile("olga@example.ru", mnemos, new Map())).toEqual({ type: "user", id: "olga@example.ru", name: "Ольга Никонова" });
    expect(notYetSignedInProfile("Olga@example.ru", mnemos, new Map())).toBeNull();
    expect(notYetSignedInProfile("new@example.ru", mnemos, new Map())).toBeNull();
    expect(notYetSignedInProfile("olga@example.ru", mnemos, new Map([["olga@example.ru", "olga"]]))).toBeNull();
    expect(notYetSignedInProfile("olga@example.ru", null, new Map())).toBeNull();
    expect(notYetSignedInProfile("olga@example.ru", await collectMnemosPeople(employeeUi, OWNER), new Map())).toBeNull();
  });

  it("справочник хранит принципал Mnemos и отдаёт его вместе с привязками", async () => {
    const directory = env.TEST_ADMIN_SETTINGS.getByName("");
    await directory.recordDirectoryUser({ id: "vera@example.ru", name: "Вера", mnemos: { tenant: TENANT, principal: "p-vera" } });
    await directory.recordDirectoryUser({ id: "bad@example.ru", name: "Плохой", mnemos: { tenant: "", principal: "p" } });
    const snapshot = await directory.directorySnapshot();
    expect(snapshot.entries.find(e => e.id === "vera@example.ru")).toEqual({ id: "vera@example.ru", name: "Вера", mnemos: { tenant: TENANT, principal: "p-vera" } });
    expect(snapshot.entries.find(e => e.id === "bad@example.ru")).toEqual({ id: "bad@example.ru", name: "Плохой" });
    expect(typeof snapshot.aliases).toBe("object");
  });
});

describe("principalsForUsers: пользователь оболочки → принципал Mnemos для фото", () => {
  const directory = [
    { id: "anna", name: "Анна", mnemos: { tenant: "org", principal: "p-anna" } },
    { id: "stranger", name: "Чужой", mnemos: { tenant: "other", principal: "p-other" } },
    { id: "ivan", name: "Иван" },
  ];
  const mnemos = { tenant: "org", self: "p-owner", manager: false, people: [
    { principal: "p-ivan", name: "Иван", email: "ivan@corp.example", departments: [] },
    { principal: "p-olga", name: "Ольга", email: "olga@corp.example", departments: [] },
  ] };
  const aliases = new Map([["ivan@corp.example", "ivan"]]);
  it("принципал из справочника входа, почта через LOGIN_ALIASES и почта как имя входа", () => {
    expect(principalsForUsers(["anna", "ivan", "olga@corp.example", "nobody"], { tenant: "org", directory, aliases, mnemos }))
      .toEqual({ anna: "p-anna", ivan: "p-ivan", "olga@corp.example": "p-olga" });
  });
  it("чужая организация не отдаёт принципалов", () => {
    expect(principalsForUsers(["stranger"], { tenant: "org", directory, aliases, mnemos })).toEqual({});
    expect(principalsForUsers(["ivan", "anna"], { tenant: "other", directory, aliases, mnemos })).toEqual({});
  });
});
