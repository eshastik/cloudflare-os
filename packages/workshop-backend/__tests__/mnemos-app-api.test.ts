// Приложение как файл проекта Mnemos (ADR 0028, этапы 1–2): строгий формат узла и связь с экземпляром —
// права Mnemos при открытии, на каждом вызове, по таймеру и со сроком; общий экземпляр — только
// опубликованные версии; справочник общего экземпляра — пересечение с видимым запустившему.
import { describe, expect, it, vi } from "vitest";
vi.mock("capnweb-validate", () => ({ validateRpc: () => () => undefined }));
import {
  GadgetAppFormatError, gadgetAppSha256, gadgetAppText, parseGadgetAppDocument, parseGadgetAppText, parseMnemosAppBinding,
  type GadgetAppCaller, type GadgetAppDocument,
} from "@gadgets/workshop-shared/gadget-app";
import type { GatekeeperAppAccess } from "@gadgets/workshop-shared/gatekeeper";
import {
  APP_ACCESS_CLOSED, APP_CHECK_MS, APP_CHECK_TIMEOUT_MS, APP_COPY_REQUIRED, APP_EDIT_REQUIRED, APP_VERSION_UNAVAILABLE, copyNodeName, openMnemosAppConnection,
  type AppObjectPort, type MnemosAppPorts,
} from "../src/mnemos-app-api";
import { APP_PUBLISHED_ONLY, intersectDirectory, mnemosAppObjectName, mnemosAppReleaseName, type DeployOptions } from "../src/mnemos-app";

const DOC: GadgetAppDocument = {
  manifest: { title: "Список дел", description: "Общий список", collaborative: true, session: true, formatVersion: 1, permissions: ["directory"] },
  modules: { "client.js": "document.body.textContent = 'ok'", "server.js": "export class Gadget { session(c) { return c } }" },
};
const SOLO: GadgetAppDocument = { ...DOC, manifest: { ...DOC.manifest, collaborative: false, session: false } };
const PRIVATE = "private:" + "b".repeat(64);

describe("формат узла приложения", () => {
  it("принимает ровно манифест и два модуля, текст канонический", async () => {
    const text = gadgetAppText(DOC);
    expect(parseGadgetAppText(text).document).toEqual(DOC);
    expect(gadgetAppText(parseGadgetAppText(text).document)).toBe(text);
    expect(await gadgetAppSha256(text)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("отказывает лишним полям, чужим модулям, размерам, разрешениям и общему приложению без session", () => {
    const bad: unknown[] = [
      { ...DOC, extra: 1 },
      { ...DOC, modules: { ...DOC.modules, "helper.js": "x" } },
      { ...DOC, modules: { "client.js": "x" } },
      { ...DOC, modules: { ...DOC.modules, "server.js": "" } },
      { ...DOC, modules: { ...DOC.modules, "server.js": "x".repeat(1024 * 1024 + 1) } },
      { ...DOC, manifest: { ...DOC.manifest, permissions: ["network"] } },
      { ...DOC, manifest: { ...DOC.manifest, permissions: ["directory", "directory"] } },
      { ...DOC, manifest: { ...DOC.manifest, title: "" } },
      { ...DOC, manifest: { ...DOC.manifest, title: "две\nстроки" } },
      { ...DOC, manifest: { ...DOC.manifest, collaborative: "yes" } },
      { ...DOC, manifest: { ...DOC.manifest, formatVersion: 2 } },
      { ...DOC, manifest: { ...DOC.manifest, session: false } },
      { ...DOC, manifest: { title: "x", description: "", collaborative: false, formatVersion: 1, permissions: [] } },
    ];
    for (const value of bad) expect(() => parseGadgetAppDocument(value)).toThrow(GadgetAppFormatError);
    expect(() => parseGadgetAppText("{")).toThrow(GadgetAppFormatError);
    expect(() => parseGadgetAppText(JSON.stringify({ format: "cloudflareos.document", formatVersion: 1, document: DOC }))).toThrow(GadgetAppFormatError);
    expect(() => parseGadgetAppText(JSON.stringify({ format: "cloudflareos.app", formatVersion: 1, document: DOC, code: "x" }))).toThrow(GadgetAppFormatError);
  });

  it("привязка проверяется строго", () => {
    const binding = { accountId: 1, scope: "p", resource: "n", description: "", collaborative: true, session: true, permissions: [], savedCodeVersion: 3, savedVersion: PRIVATE };
    expect(parseMnemosAppBinding(binding)).toEqual(binding);
    expect(() => parseMnemosAppBinding({ ...binding, token: "x" })).toThrow();
    expect(() => parseMnemosAppBinding({ ...binding, savedHead: "zz" })).toThrow();
    expect(() => parseMnemosAppBinding({ ...binding, permissions: ["network"] })).toThrow();
    expect(() => parseMnemosAppBinding({ ...binding, session: false })).toThrow();
  });

  it("ключ объекта: установка, узел, организация и владелец своего экземпляра различают объекты", () => {
    const I = "https://a.example";
    expect(mnemosAppObjectName(I, "t", "p", "n1")).not.toBe(mnemosAppObjectName(I, "t", "p", "n2"));
    expect(mnemosAppObjectName(I, "t1", "p", "n")).not.toBe(mnemosAppObjectName(I, "t2", "p", "n"));
    // Разные установки Mnemos с совпавшими id — разные экземпляры, и общий, и свой.
    expect(mnemosAppObjectName(I, "t", "p", "n")).not.toBe(mnemosAppObjectName("https://b.example", "t", "p", "n"));
    expect(mnemosAppObjectName(I, "t", "p", "n", "anna")).not.toBe(mnemosAppObjectName("https://b.example", "t", "p", "n", "anna"));
    expect(mnemosAppObjectName(I, "t", "p", "n", "anna")).not.toBe(mnemosAppObjectName(I, "t", "p", "n"));
    expect(mnemosAppObjectName(I, "t", "p", "n", "anna")).not.toBe(mnemosAppObjectName(I, "t", "p", "n", "boris"));
    expect(() => mnemosAppObjectName("", "t", "p", "n")).toThrow();
    expect(() => mnemosAppObjectName(I, "", "p", "n")).toThrow();
  });

  it("справочник общего экземпляра — пересечение видимого открывшему и запустившему; без запустившего — пусто", () => {
    const admin = {
      people: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }, { id: "ceo", name: "Директор" }],
      departments: [{ id: "sales", name: "Продажи", members: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }] }, { id: "board", name: "Правление", members: [{ id: "ceo", name: "Директор" }] }],
    };
    expect(intersectDirectory(admin, { people: ["anna", "boris"], units: ["sales"] })).toEqual({
      people: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }],
      departments: [{ id: "sales", name: "Продажи", members: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }] }],
    });
    expect(intersectDirectory(admin, null)).toEqual({ people: [], departments: [] });
  });
});

async function harness(options: { access?: GatekeeperAppAccess["access"]; deployed?: string | null; versionReadable?: boolean; published?: string | null; permissions?: string[]; doc?: GadgetAppDocument } = {}) {
  const doc = options.doc ?? DOC;
  const text = gadgetAppText(doc);
  const sha = await gadgetAppSha256(text);
  const clock = { now: 1_000_000 };
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  let access: GatekeeperAppAccess["access"] | "none" | "hang" = options.access ?? "edit";
  let versionReadable = options.versionReadable ?? true;
  let identity = { principal: "anna", installation: "https://mnemos.example", project: "project-canonical", node: "node-canonical" };
  const calls = { access: 0, abort: [] as string[], deploy: [] as { version: string; by: string; options: DeployOptions }[], sessions: [] as GadgetAppCaller[], methods: [] as string[], keys: [] as string[] };
  let deployed = options.deployed ? { version: options.deployed, sha256: sha, title: "Список дел", collaborative: doc.manifest.collaborative, session: doc.manifest.session, permissions: options.permissions ?? ["directory"], deployedAt: "", deployedBy: "owner" } : null;
  const releases: { version: string; author: string }[] = [];
  const object = {
    release: async () => null,
    setRelease: async (version: string, sha256: string, _text: string, publishedAt: string, authorName: string) => { releases.push({ version, author: authorName }); return { version, sha256, title: "", publishedAt, authorName, recordedAt: "" }; },
    state: async () => ({ deployed }),
    deploy: async (version, sha256, _text, by, deployOptions) => {
      calls.deploy.push({ version, by, options: deployOptions });
      deployed = { version, sha256, title: "Список дел", collaborative: doc.manifest.collaborative, session: doc.manifest.session, permissions: ["directory"], deployedAt: "", deployedBy: by };
      return deployed;
    },
    uiBundle: async () => deployed ? { jsCode: doc.modules["client.js"] } : null,
    session: async caller => {
      calls.sessions.push(caller);
      return { add: async (x: string) => { calls.methods.push(`add:${x}`); return x; }, whoami: async () => caller.principal };
    },
  } as unknown as AppObjectPort;
  const ports: MnemosAppPorts = {
    access: async () => {
      calls.access++;
      if (access === "none") throw new Error("no");
      if (access === "hang") return new Promise<never>(() => {});
      return { access, tenant: "org", name: "Анна", ...identity };
    },
    version: async version => { if (!versionReadable) throw new Error("403"); return { sha256: version === "bad" ? "0".repeat(64) : sha, contentType: "application/vnd.cloudflareos.app+json" }; },
    text: async version => { if (!versionReadable) throw new Error("403"); return { text, sha256: version === "bad" ? "0".repeat(64) : sha, contentType: "application/vnd.cloudflareos.app+json" }; },
    latestPublished: async () => options.published === undefined ? "event-2" : options.published,
    publishedHead: async () => { const id = options.published === undefined ? "event-2" : options.published; return id ? { id, recordedAt: "2026-09-29T10:00:00Z", actor: "anna" } : null; },
    node: () => { throw new Error("не нужен"); },
    createApp: async () => { throw new Error("не нужен"); },
    saveApp: async () => { throw new Error("не нужен"); },
    directory: async () => ({ people: [{ id: "boris", name: "Борис" }], departments: [{ id: "u1", name: "Продажи", members: [{ id: "boris", name: "Борис" }] }] }),
    object: name => { calls.keys.push(name); return object; },
    profileName: async () => "Профиль",
    now: () => clock.now,
    schedule: (ms, run) => { const timer = { at: clock.now + ms, run, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    abort: reason => { calls.abort.push(reason.message); },
    release: () => {},
  };
  const advance = async (ms: number) => {
    clock.now += ms;
    for (const timer of timers.filter(t => !t.cancelled && t.at <= clock.now)) { timer.cancelled = true; timer.run(); }
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
  };
  return { ports, calls, text, sha, clock, advance, releases, setAccess: (value: typeof access) => { access = value; }, setVersionReadable: (value: boolean) => { versionReadable = value; },
    setIdentity: (change: Partial<typeof identity>) => { identity = { ...identity, ...change }; } };
}

describe("связь с экземпляром", () => {
  it("без доступа к узлу связь не открывается; ключ — из ответа Mnemos, свой экземпляр — с principal", async () => {
    const h = await harness();
    h.setAccess("none");
    await expect(openMnemosAppConnection(h.ports, false)).rejects.toThrow();
    h.setAccess("read");
    await openMnemosAppConnection(h.ports, false);
    await openMnemosAppConnection(h.ports, true);
    expect(h.calls.keys).toEqual([mnemosAppObjectName("https://mnemos.example", "org", "project-canonical", "node-canonical"), mnemosAppObjectName("https://mnemos.example", "org", "project-canonical", "node-canonical", "anna")]);
  });

  it("повторная проверка назвала другого человека, установку или узел — отказ и закрытие сеанса", async () => {
    for (const change of [{ principal: "boris" }, { installation: "https://other.example" }, { node: "node-other" }, { project: "project-other" }]) {
      const h = await harness({ deployed: "event-1" });
      const connection = await openMnemosAppConnection(h.ports, false);
      const session = await connection.connectToGadget() as { add(x: string): Promise<string> };
      h.setIdentity(change);
      h.clock.now += APP_CHECK_MS;
      await expect(session.add("x")).rejects.toThrow(APP_ACCESS_CLOSED);
      expect(h.calls.abort).toEqual([APP_ACCESS_CLOSED]);
      expect(h.calls.methods).toEqual([]);
    }
  });

  it("сервер гаджета получает вызывающего: principal, имя, право и справочник только по разрешению", async () => {
    const h = await harness({ deployed: "event-1", access: "read" });
    const connection = await openMnemosAppConnection(h.ports, false);
    expect(await connection.describe()).toMatchObject({ access: "read", caller: { principal: "anna", name: "Анна" } });
    const session = await connection.connectToGadget() as { whoami(): Promise<string> };
    expect(await session.whoami()).toBe("anna");
    expect(h.calls.sessions[0]).toMatchObject({ principal: "anna", name: "Анна", access: "read", directory: { people: [{ id: "boris", name: "Борис" }] } });
    const plain = await harness({ deployed: "event-1", permissions: [] });
    await (await openMnemosAppConnection(plain.ports, false)).connectToGadget();
    expect(plain.calls.sessions[0]).toEqual({ principal: "anna", name: "Анна", access: "edit" });
  });

  it("каждый вызов после 30 с перепроверяет право; отзыв закрывает сеанс", async () => {
    const h = await harness({ deployed: "event-1" });
    const connection = await openMnemosAppConnection(h.ports, false);
    const session = await connection.connectToGadget() as { add(x: string): Promise<string> };
    const before = h.calls.access;
    expect(await session.add("1")).toBe("1");
    expect(h.calls.access).toBe(before);
    h.setAccess("none");
    h.clock.now += APP_CHECK_MS;
    await expect(session.add("2")).rejects.toThrow(APP_ACCESS_CLOSED);
    expect(h.calls.methods).toEqual(["add:1"]);
    expect(h.calls.abort).toEqual([APP_ACCESS_CLOSED]);
    await expect(connection.describe()).rejects.toThrow(APP_ACCESS_CLOSED);
  });

  it("отзыв без вызовов: таймер раз в 30 с закрывает сеанс", async () => {
    const h = await harness({ deployed: "event-1" });
    const connection = await openMnemosAppConnection(h.ports, false);
    await connection.connectToGadget();
    await h.advance(APP_CHECK_MS);
    expect(h.calls.abort).toEqual([]);
    h.setAccess("none");
    await h.advance(APP_CHECK_MS);
    expect(h.calls.abort).toEqual([APP_ACCESS_CLOSED]);
  });

  it("зависшая проверка права просрочивается через 10 с: отказ и закрытие сеанса", async () => {
    const h = await harness({ deployed: "event-1" });
    const connection = await openMnemosAppConnection(h.ports, false);
    await connection.connectToGadget();
    h.setAccess("hang");
    await h.advance(APP_CHECK_MS);
    expect(h.calls.abort).toEqual([]);
    await h.advance(APP_CHECK_TIMEOUT_MS);
    expect(h.calls.abort).toEqual([APP_ACCESS_CLOSED]);
  });

  it("понижение права с правки до чтения закрывает сеанс", async () => {
    const h = await harness({ deployed: "event-1", access: "edit" });
    const connection = await openMnemosAppConnection(h.ports, false);
    await connection.connectToGadget();
    h.setAccess("read");
    await expect(connection.describe()).rejects.toThrow(APP_ACCESS_CLOSED);
    expect(h.calls.abort).toHaveLength(1);
  });

  it("работающая версия недоступна открывшему — экрана и связи нет", async () => {
    const h = await harness({ deployed: "event-1", access: "read", versionReadable: false });
    const connection = await openMnemosAppConnection(h.ports, false);
    await expect(connection.getUiBundle()).rejects.toThrow(APP_VERSION_UNAVAILABLE);
    await expect(connection.connectToGadget()).rejects.toThrow(APP_VERSION_UNAVAILABLE);
    expect(h.calls.sessions).toHaveLength(0);
  });

  it("общий экземпляр: личную версию не запускает никто, даже с правкой (участник с черновиком)", async () => {
    const h = await harness({ deployed: "event-1", access: "edit" });
    const editor = await openMnemosAppConnection(h.ports, false);
    await expect(editor.deploy(PRIVATE)).rejects.toThrow(APP_PUBLISHED_ONLY);
    expect(h.calls.deploy).toEqual([]);
  });

  it("общий экземпляр: с правкой — опубликованная версия и справочник запустившего; сумма сверяется", async () => {
    const h = await harness({ deployed: "event-1", access: "edit" });
    const editor = await openMnemosAppConnection(h.ports, false);
    await editor.deploy("event-2");
    expect(h.calls.deploy).toEqual([{ version: "event-2", by: "anna", options: { kind: "shared", onlyIfEmpty: false, directoryScope: { people: ["boris"], units: ["u1"] } } }]);
    await expect(editor.deploy("bad")).rejects.toThrow(/недоступна или повреждена/);
    const solo = await harness({ doc: SOLO });
    await expect((await openMnemosAppConnection(solo.ports, false)).deploy("event-2")).rejects.toThrow(/не совместное/);
  });

  it("общий экземпляр без права правки: только последняя опубликованная, только в пустой экземпляр, справочник не записывается", async () => {
    const reader = await harness({ deployed: "event-1", access: "read", published: "event-2" });
    const viewer = await openMnemosAppConnection(reader.ports, false);
    await expect(viewer.deploy("event-1")).rejects.toThrow(APP_EDIT_REQUIRED);
    await viewer.deploy("event-2");
    expect(reader.calls.deploy).toEqual([{ version: "event-2", by: "anna", options: { kind: "shared", onlyIfEmpty: true, directoryScope: null } }]);
    const onlyPrivate = await harness({ access: "read", published: null });
    await expect((await openMnemosAppConnection(onlyPrivate.ports, false)).deploy(PRIVATE)).rejects.toThrow(APP_PUBLISHED_ONLY);
  });

  it("свой экземпляр: с правом правки — любая доступная версия личного приложения, совместное — отказ", async () => {
    const solo = await harness({ doc: SOLO, access: "edit" });
    const mine = await openMnemosAppConnection(solo.ports, true);
    await mine.deploy(PRIVATE);
    expect(solo.calls.deploy).toEqual([{ version: PRIVATE, by: "anna", options: { kind: "personal", onlyIfEmpty: false, directoryScope: null } }]);
    const shared = await harness();
    await expect((await openMnemosAppConnection(shared.ports, true)).deploy("event-2")).rejects.toThrow(/общим экземпляром/);
  });

  it("свой экземпляр получателя без права правки: только последняя опубликованная версия, иначе — своя копия", async () => {
    const solo = await harness({ doc: SOLO, access: "read", published: "event-2" });
    const reader = await openMnemosAppConnection(solo.ports, true);
    await expect(reader.deploy(PRIVATE)).rejects.toThrow(APP_COPY_REQUIRED);
    await expect(reader.deploy("event-1")).rejects.toThrow(APP_COPY_REQUIRED);
    expect(solo.calls.deploy).toEqual([]);
    await reader.deploy("event-2");
    expect(solo.calls.deploy.map(d => d.version)).toEqual(["event-2"]);
  });

  it("публикация автора в своём экземпляре становится версией для копий; личная версия — нет", async () => {
    const solo = await harness({ doc: SOLO, access: "edit", published: "event-2" });
    const author = await openMnemosAppConnection(solo.ports, true);
    await author.deploy(PRIVATE);
    expect(solo.releases).toEqual([]);
    await author.deploy("event-2");
    expect(solo.releases).toEqual([{ version: "event-2", author: "Анна" }]);
    expect(solo.calls.keys).toContain(mnemosAppReleaseName("https://mnemos.example", "org", "project-canonical", "node-canonical"));
  });

  it("совместное приложение копий не даёт: «Поделиться» — доступ к общему экземпляру", async () => {
    const h = await harness({ deployed: "event-1" });
    const shared = await openMnemosAppConnection(h.ports, false);
    await expect(shared.offer()).rejects.toThrow(/общему экземпляру/);
    await expect(shared.makeCopy("p", false)).rejects.toThrow(/общему экземпляру/);
    expect(await shared.copyState()).toBeNull();
  });

  it("имя копии: пометка «(копия)», без косых черт, не длиннее 255 байт", () => {
    expect(copyNodeName("Учёт/задач")).toBe("Учёт задач (копия)");
    expect(new TextEncoder().encode(copyNodeName("я".repeat(200))).length).toBeLessThanOrEqual(255);
  });
});
