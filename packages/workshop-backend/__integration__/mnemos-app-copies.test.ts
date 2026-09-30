// Копии приложения без совместной работы (ADR 0028, этап 3) на настоящих Durable Object: получатель
// делает свою копию опубликованной версии автора с пустой базой, обновление ставится только по его
// согласию и сохраняет данные, отзыв доступа к оригиналу копию не трогает, личная версия автора в копию
// не попадает, запись идёт только в узел копии. Mnemos подделан: узлы, версии, права, история.
import { exports } from "cloudflare:workers";
import { gadgetAppSha256, gadgetAppText, type GadgetAppDocument } from "@gadgets/workshop-shared/gadget-app";
import type { GatekeeperAppAccess } from "@gadgets/workshop-shared/gatekeeper";
import { expect, it } from "vitest";
import {
  APP_ACCESS_CLOSED, APP_COPY_REQUIRED, APP_NO_RELEASE, APP_ORIGIN_CLOSED, APP_UPDATE_CHANGED, openMnemosAppConnection,
  type AppNodePorts, type AppObjectPort, type MnemosAppPorts,
} from "../src/mnemos-app-api";
import { mnemosAppObjectName, mnemosAppReleaseName } from "../src/mnemos-app";

const SERVER = `
import { DurableObject, RpcTarget } from "cloudflare:workers";
class Session extends RpcTarget {
  constructor(app, caller) { super(); this.app = app; this.caller = caller; }
  async add(text) { return this.app.add(this.caller, text); }
  async list() { return this.app.list(); }
  async version() { return VERSION; }
}
const VERSION = "__VERSION__";
export class Gadget extends DurableObject {
  session(caller) { return new Session(this, caller); }
  add(caller, text) { const items = this.ctx.storage.kv.get("items") ?? []; items.push({ by: caller.principal, text }); this.ctx.storage.kv.put("items", items); return items.length; }
  list() { return this.ctx.storage.kv.get("items") ?? []; }
}`;
const doc = (version: string, collaborative = false): GadgetAppDocument => ({
  manifest: { title: "Мои задачи", description: "", collaborative, session: true, formatVersion: 1, permissions: [] },
  modules: { "client.js": `document.body.textContent = ${JSON.stringify(version)}`, "server.js": SERVER.replace("__VERSION__", version) },
});
type Session = { add(text: string): Promise<number>; list(): Promise<{ by: string; text: string }[]>; version(): Promise<string> };

const INSTALLATION = "https://mnemos.example";
const DENIED = "Приложение вам недоступно: нет доступа к этому файлу проекта.";
const hex = (n: number) => n.toString(16).padStart(64, "0");

/** Узел Mnemos: владелец, личные версии владельца, публикации, приглашённые на чтение, кто видит историю. */
type Node = { project: string; owner: string; heads: string[]; texts: Map<string, string>; published: { id: string; recordedAt: string; actor: string }[]; readers: Set<string>; history: Set<string> };

/** Подделка установки Mnemos: несколько людей, узлы в проектах, права как у настоящего моста. */
function world(denial: () => Error = () => Object.assign(new Error(DENIED), { code: "app_access_denied" })) {
  const nodes = new Map<string, Node>();
  let counter = 0;
  const writes: { principal: string; project: string; node: string }[] = [];
  const forks: { principal: string; from: { project: string; node: string }; to: { project: string; node: string }; sha: string }[] = [];
  let forkError: Error | null = null;
  const key = (project: string, node: string) => `${project}/${node}`;
  const addNode = (project: string, node: string, owner: string) => { nodes.set(key(project, node), { project, owner, heads: [], texts: new Map(), published: [], readers: new Set(), history: new Set() }); return node; };
  const save = (project: string, node: string, text: string) => {
    const n = nodes.get(key(project, node))!;
    const head = hex(++counter);
    n.heads.unshift(head); n.texts.set(`private:${head}`, text);
    return head;
  };
  const publish = (project: string, node: string, text: string, actor: string) => {
    const n = nodes.get(key(project, node))!;
    const id = `event-${++counter}`;
    n.texts.set(id, text); n.published.unshift({ id, recordedAt: new Date(Date.UTC(2026, 8, 29, 10, counter)).toISOString(), actor });
    save(project, node, text);
    return id;
  };
  const nodePorts = (principal: string, project: string, node: string): AppNodePorts => {
    const find = () => nodes.get(key(project, node));
    const right = (): "edit" | "read" | null => { const n = find(); return !n ? null : n.owner === principal ? "edit" : n.readers.has(principal) || n.history.has(principal) ? "read" : null; };
    const canRead = (version: string) => {
      const n = find(); if (!n || !right()) return false;
      // Приглашённый читает голову ветки владельца; опубликованное — только тот, кому видна история.
      if (version.startsWith("private:")) return n.owner === principal || n.heads[0] === version.slice(8);
      return n.owner === principal || n.history.has(principal);
    };
    const read = async (version: string) => {
      const text = find()?.texts.get(version);
      if (!text || !canRead(version)) throw new Error("403");
      return { text, sha256: await gadgetAppSha256(text), contentType: "application/vnd.cloudflareos.app+json" };
    };
    const head = () => { const n = find(); return n && (n.owner === principal || n.history.has(principal)) ? n.published[0] ?? null : null; };
    return {
      access: async opening => {
        const access = right();
        if (!access) throw denial();
        return { access, principal, tenant: opening ? "org-1" : "", name: principal, project, node, installation: INSTALLATION } satisfies GatekeeperAppAccess;
      },
      version: async version => { const { sha256, contentType } = await read(version); return { sha256, contentType }; },
      text: read,
      latestPublished: async () => head()?.id ?? null,
      publishedHead: async () => head(),
    };
  };
  const ports = (principal: string, project: string, node: string): MnemosAppPorts => ({
    ...nodePorts(principal, project, node),
    node: (p, n) => nodePorts(principal, p, n),
    createApp: async (p, _name, text) => {
      if (!p.startsWith(`${principal}-`)) throw new Error("403");
      const created = addNode(p, `copy-${++counter}`, principal);
      writes.push({ principal, project: p, node: created });
      return { node: created, head: save(p, created, text) };
    },
    saveApp: async (p, n, text) => {
      if (nodes.get(key(p, n))?.owner !== principal) throw new Error("Обновить копию может только её владелец.");
      writes.push({ principal, project: p, node: n });
      return save(p, n, text);
    },
    forkSources: async (from, to, sha) => { if (forkError) throw forkError; forks.push({ principal, from, to, sha }); },
    directory: async () => ({ people: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }], departments: [] }),
    object: name => exports.MnemosAppDurableObject.getByName(name) as unknown as AppObjectPort,
    profileName: async () => principal,
    now: () => Date.now(),
    schedule: () => () => {},
    abort: () => {},
    release: () => {},
  });
  const open = (principal: string, project: string, node: string, personal = true) => openMnemosAppConnection(ports(principal, project, node), personal);
  return { nodes, writes, forks, failFork: (error: Error | null) => { forkError = error; }, addNode, save, publish, open, share: (project: string, node: string, who: string) => nodes.get(key(project, node))!.readers.add(who),
    revoke: (project: string, node: string, who: string) => { const n = nodes.get(key(project, node))!; n.readers.delete(who); n.history.delete(who); } };
}

const refused = (promise: Promise<unknown>) => promise.then(() => "принято", (error: Error) => error.message);

/** Автор публикует v1 и открывает приложение: версия для копий записана; Борис приглашён на чтение. */
async function authored(denial?: () => Error) {
  const w = world(denial);
  const project = "anna-" + crypto.randomUUID(), node = w.addNode(project, "app-" + crypto.randomUUID(), "anna");
  const v1 = w.publish(project, node, gadgetAppText(doc("v1")), "anna");
  const author = await w.open("anna", project, node);
  await author.deploy(v1);
  w.share(project, node, "boris");
  return { w, project, node, v1, author, borisProject: "boris-" + crypto.randomUUID() };
}

it("поделиться: получатель делает свою копию — опубликованная версия автора, свой узел, пустая база", async () => {
  const { w, project, node, v1, author, borisProject } = await authored();
  await (await author.connectToGadget() as Session).add("данные автора");
  // Черновик автора после публикации в копию не попадает.
  w.save(project, node, gadgetAppText(doc("v2-черновик")));
  const original = await w.open("boris", project, node);
  expect(await refused(original.deploy(`private:${w.nodes.get(`${project}/${node}`)!.heads[0]}`))).toBe(APP_COPY_REQUIRED);
  const offer = await original.offer();
  expect(offer).toMatchObject({ release: { version: v1, title: "Мои задачи", authorName: "Анна" }, copy: null });

  const copy = await original.makeCopy(borisProject, false);
  expect(copy.scope).toBe(borisProject);
  expect(w.writes).toEqual([{ principal: "boris", project: borisProject, node: copy.resource }]);
  const mine = await w.open("boris", copy.scope, copy.resource);
  expect((await mine.describe()).access).toBe("edit");
  const screen = await mine.connectToGadget() as Session;
  expect(await screen.version()).toBe("v1");
  // Своя пустая база: данных автора в копии нет, данные получателя не попадают к автору.
  expect(await screen.list()).toEqual([]);
  await screen.add("данные Бориса");
  expect((await (await author.connectToGadget() as Session).list()).map(i => i.text)).toEqual(["данные автора"]);
  expect(await mine.copyState()).toMatchObject({ author: "Анна", version: v1, origin: "open", update: null, dismissed: false });
  // Повторное открытие оригинала находит ту же копию, новой не создаёт.
  expect((await original.offer()).copy).toEqual(copy);
  expect(await original.makeCopy(borisProject, false)).toEqual(copy);
  expect(w.writes).toHaveLength(1);
});

it("обновление — только по согласию: предлагается, «Не сейчас» запоминается, «Обновить» сохраняет данные", async () => {
  const { w, project, node, author, borisProject } = await authored();
  const copy = await (await w.open("boris", project, node)).makeCopy(borisProject, false);
  const mine = await w.open("boris", copy.scope, copy.resource);
  await (await mine.connectToGadget() as Session).add("остаётся");

  const v2 = w.publish(project, node, gadgetAppText(doc("v2")), "anna");
  await author.deploy(v2);
  const state = await mine.copyState();
  expect(state).toMatchObject({ origin: "open", update: { version: v2, authorName: "Анна" }, dismissed: false });
  // Само ничего не меняется.
  expect(await (await mine.connectToGadget() as Session).version()).toBe("v1");
  await mine.dismissUpdate(v2);
  expect(await mine.copyState()).toMatchObject({ update: { version: v2 }, dismissed: true });
  // Ставится ровно показанная версия.
  expect(await refused(mine.applyUpdate("event-чужая"))).toBe(APP_UPDATE_CHANGED);

  const writesBefore = w.writes.length;
  const { version } = await mine.applyUpdate(v2);
  expect(version).toMatch(/^private:/);
  // Запись — только в узел копии получателя; оригинал автора не менялся.
  expect(w.writes.slice(writesBefore)).toEqual([{ principal: "boris", project: copy.scope, node: copy.resource }]);
  const after = await mine.connectToGadget() as Session;
  expect(await after.version()).toBe("v2");
  expect((await after.list()).map(i => i.text)).toEqual(["остаётся"]);
  expect(await mine.copyState()).toMatchObject({ version: v2, update: null, dismissed: false });
});

it("отзыв доступа к оригиналу: копия остаётся и работает, обновлений нет, «Обновить» объясняет почему", async () => {
  const { w, project, node, author, borisProject } = await authored();
  const copy = await (await w.open("boris", project, node)).makeCopy(borisProject, false);
  const mine = await w.open("boris", copy.scope, copy.resource);
  await (await mine.connectToGadget() as Session).add("моё");
  const v2 = w.publish(project, node, gadgetAppText(doc("v2")), "anna");
  await author.deploy(v2);
  w.revoke(project, node, "boris");
  expect(await mine.copyState()).toMatchObject({ origin: "closed", update: null });
  expect(await refused(mine.applyUpdate(v2))).toBe(APP_ORIGIN_CLOSED);
  const reopened = await w.open("boris", copy.scope, copy.resource);
  expect((await (await reopened.connectToGadget() as Session).list()).map(i => i.text)).toEqual(["моё"]);
  expect(await refused(w.open("boris", project, node))).toBe(DENIED);
});

it("копия не открывает данных и кода автору чужих: другой человек не обновляет чужую копию и не видит её связь", async () => {
  const { w, project, node, borisProject } = await authored();
  const copy = await (await w.open("boris", project, node)).makeCopy(borisProject, false);
  // Анну Борис пригласил к своей копии на чтение: у неё свой экземпляр без связи с оригиналом.
  w.share(copy.scope, copy.resource, "anna");
  const guest = await w.open("anna", copy.scope, copy.resource);
  expect(await guest.copyState()).toBeNull();
  expect(await refused(guest.applyUpdate("event-1"))).toMatch(/только её владелец/);
  // Объекты копии и оригинала разные: ключ — узел копии и её владелец.
  expect(mnemosAppObjectName(INSTALLATION, "org-1", copy.scope, copy.resource, "boris")).not.toBe(mnemosAppObjectName(INSTALLATION, "org-1", project, node, "boris"));
});

it("без публикации копии нет; версия для копий не принимает совместное приложение и личную версию, сумма сверяется", async () => {
  const w = world();
  const project = "anna-" + crypto.randomUUID(), node = w.addNode(project, "app-" + crypto.randomUUID(), "anna");
  w.save(project, node, gadgetAppText(doc("черновик")));
  w.share(project, node, "boris");
  const original = await w.open("boris", project, node);
  expect(await original.offer()).toEqual({ release: null, copy: null });
  expect(await refused(original.makeCopy("boris-" + crypto.randomUUID(), false))).toBe(APP_NO_RELEASE);

  const release = exports.MnemosAppDurableObject.getByName(mnemosAppReleaseName(INSTALLATION, "org-1", project, node)) as unknown as AppObjectPort;
  const solo = gadgetAppText(doc("v1")), shared = gadgetAppText(doc("v1", true));
  expect(await refused(release.setRelease("private:" + hex(1), await gadgetAppSha256(solo), solo, "2026-09-29T10:00:00Z", ""))).toMatch(/Invalid release/);
  expect(await refused(release.setRelease("event-1", await gadgetAppSha256(shared), shared, "2026-09-29T10:00:00Z", ""))).toMatch(/Совместное/);
  expect(await refused(release.setRelease("event-1", "0".repeat(64), solo, "2026-09-29T10:00:00Z", ""))).toMatch(/не совпадает/);
  await release.setRelease("event-2", await gadgetAppSha256(solo), solo, "2026-09-29T11:00:00Z", "");
  // Более старая публикация не заменяет более новую.
  expect(await refused(release.setRelease("event-1", await gadgetAppSha256(solo), solo, "2026-09-29T10:00:00Z", ""))).toMatch(/новее/);
  // Объект версии для копий не запускается как экземпляр.
  expect(await refused(release.deploy("event-2", await gadgetAppSha256(solo), solo, "anna", { kind: "personal", onlyIfEmpty: false, directoryScope: null }))).toMatch(/Invalid deployment/);
});

it("совместное приложение — как раньше: «Поделиться» даёт доступ к общему экземпляру, копий нет", async () => {
  const w = world();
  const project = "anna-" + crypto.randomUUID(), node = w.addNode(project, "app-" + crypto.randomUUID(), "anna");
  const v1 = w.publish(project, node, gadgetAppText(doc("v1", true)), "anna");
  const author = await w.open("anna", project, node, false);
  await author.deploy(v1);
  w.nodes.get(`${project}/${node}`)!.history.add("boris");
  const reader = await w.open("boris", project, node, false);
  await (await author.connectToGadget() as Session).add("общее");
  expect((await (await reader.connectToGadget() as Session).list()).map(i => i.text)).toEqual(["общее"]);
  expect(await refused(reader.offer())).toMatch(/общему экземпляру/);
});

it("«Сделать своей»: исходники версии, из которой сделана копия, — к копии; связь с оригиналом снята, обновлений нет", async () => {
  const { w, project, node, v1, author, borisProject } = await authored();
  const copy = await (await w.open("boris", project, node)).makeCopy(borisProject, false);
  const mine = await w.open("boris", copy.scope, copy.resource);
  await (await mine.connectToGadget() as Session).add("моё");
  // Сумма версии — сумма тела файла, та же, что у версии для копий и у билета app-code.
  const sha = await gadgetAppSha256(w.nodes.get(`${project}/${node}`)!.texts.get(v1)!);
  // Чужой человек и гость копии своей её не сделают.
  w.share(copy.scope, copy.resource, "anna");
  expect(await refused((await w.open("anna", copy.scope, copy.resource)).makeOwn())).toMatch(/только её владелец/);

  // Исходников нет — отказ словами службы, связь с оригиналом остаётся.
  w.failFork(new Error("Исходники этой версии гаджета не сохранились: сделать копию своей нельзя."));
  expect(await refused(mine.makeOwn())).toMatch(/не сохранились/);
  expect(await mine.copyState()).toMatchObject({ origin: "open" });
  w.failFork(null);

  await mine.makeOwn();
  expect(w.forks).toEqual([{ principal: "boris", from: { project, node }, to: { project: copy.scope, node: copy.resource }, sha }]);
  // Копия своя: связи нет, новые публикации автора не предлагаются, данные на месте.
  const v2 = w.publish(project, node, gadgetAppText(doc("v2")), "anna");
  await author.deploy(v2);
  expect(await mine.copyState()).toBeNull();
  expect(await refused(mine.applyUpdate(v2))).toMatch(/только её владелец/);
  expect((await (await mine.connectToGadget() as Session).list()).map(i => i.text)).toEqual(["моё"]);
});

it("«Сделать своей» без доступа к оригиналу: исходники не берутся", async () => {
  const { w, project, node, borisProject } = await authored();
  const copy = await (await w.open("boris", project, node)).makeCopy(borisProject, false);
  const mine = await w.open("boris", copy.scope, copy.resource);
  w.revoke(project, node, "boris");
  expect(await refused(mine.makeOwn())).toMatch(/закрыл вам доступ к оригиналу/);
  expect(w.forks).toEqual([]);
});

it("отзыв права после предложения копии не позволяет взять старый код из кэша", async () => {
  const { w, project, node, borisProject } = await authored();
  const original = await w.open("boris", project, node);
  expect((await original.offer()).release).not.toBeNull();
  w.revoke(project, node, "boris");
  expect(await refused(original.makeCopy(borisProject, false))).toBe(APP_ACCESS_CLOSED);
  expect(w.writes).toEqual([]);
});

it("код отказа оригинала сохраняет смысл при изменении текста для человека", async () => {
  const { w, project, node, borisProject } = await authored(() => Object.assign(new Error("Владелец отозвал чтение."), { code: "app_access_denied" }));
  const copy = await (await w.open("boris", project, node)).makeCopy(borisProject, false);
  const mine = await w.open("boris", copy.scope, copy.resource);
  w.revoke(project, node, "boris");
  expect(await mine.copyState()).toMatchObject({ origin: "closed", update: null });
  expect(await refused(mine.applyUpdate("event-новый"))).toBe(APP_ORIGIN_CLOSED);
  expect(w.forks).toEqual([]);
});
