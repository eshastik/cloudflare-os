// Аватары людей во встроенном приложении: фото через мост оболочки (blob:), инициалы при отсутствии
// или ошибке, один вызов моста на экран, узкая CSP и сторож против самодельных кружков с инициалами.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://ui.example" });
for (const key of ["window", "document", "HTMLElement", "Node", "MutationObserver"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const channels = []; const OriginalMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends OriginalMessageChannel { constructor() { super(); channels.push(this); } };

const bundle = await build({ stdin: { contents: 'export {default as PeopleTab} from "./app-react/PeopleTab.tsx"; export {default as PersonAvatar} from "./app-react/PersonAvatar.tsx"; export {forgetPersonPhotos} from "./app-react/person-photos.ts"; export {HostProvider} from "./app-react/host.ts"; export {createElement,act} from "react"; export {createRoot} from "react-dom/client";', resolveDir: process.cwd() },
  bundle: true, jsx: "automatic", platform: "node", format: "esm", write: false, define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "ui-controls", setup(b) { b.onResolve({ filter: /^@cloudflare\/kumo$/ }, () => ({ path: "controls", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'import {createElement} from "react"; export function Button({variant,size,...props}){return createElement("button",props)};export function Empty(){return null}', resolveDir: process.cwd() })); } }] });
const { PeopleTab, PersonAvatar, forgetPersonPhotos, HostProvider, createElement: h, act, createRoot } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

// Отладочные строки о причинах сбоя фото глушатся: вывод дочернего процесса мешает протоколу node --test
// при запуске нескольких файлов. Проверяются они там, где это предмет теста.
const quietDebug = console.debug; console.debug = () => {};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const data = { identity: { capabilities: ["principal.manage"] }, projects: [] };
const people = [{ userName: "anna", displayName: "Анна Петрова", active: true }, { userName: "ivan", displayName: "Иван Смирнов", active: true }];
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

async function render(element, host) {
  const el = document.createElement("div"); document.body.append(el);
  const root = createRoot(el);
  await act(async () => { root.render(h(HostProvider, { value: { ui: host.ui, host } }, element)); });
  await settle();
  return { el, async close() { await act(async () => root.unmount()); el.remove(); } };
}
const avatarOf = (el, name) => [...el.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === `Открыть карточку: ${name}`)?.querySelector("[data-avatar]");

beforeEach(() => forgetPersonPhotos());

test("«Люди и отделы»: фото вместо инициалов, у человека без фото — инициалы; один вызов моста на экран", async () => {
  const calls = [];
  const host = { ui: { listPeople: async () => ({ users: people }) },
    async personPhotos(ids) { calls.push(ids); return ids.map(id => id === "anna" ? { sha256: "a".repeat(64), type: "image/jpeg", bytes: JPEG } : null); } };
  const view = await render(h(PeopleTab, { data }), host);
  try {
    const anna = avatarOf(view.el, "Анна Петрова"), ivan = avatarOf(view.el, "Иван Смирнов");
    assert.equal(anna?.getAttribute("data-avatar"), "photo");
    assert.match(anna.querySelector("img").getAttribute("src"), /^blob:/, "фото показывается через blob:, не по адресу хранилища");
    assert.equal(ivan?.getAttribute("data-avatar"), "initials");
    assert.equal(ivan.textContent, "ИС");
    assert.equal(calls.length, 1, "запросы экрана собраны в один вызов");
    assert.deepEqual([...calls[0]].sort(), ["anna", "ivan"]);
  } finally { await view.close(); }
});

test("ошибка загрузки картинки и сбой моста дают инициалы", async () => {
  const host = { ui: {}, async personPhotos(ids) { return ids.map(() => ({ sha256: "b".repeat(64), type: "image/jpeg", bytes: JPEG })); } };
  const view = await render(h(PersonAvatar, { name: "Олег Иванов", id: "oleg" }), host);
  try {
    const img = view.el.querySelector("[data-avatar=photo] img");
    assert.ok(img, "фото показано");
    await act(async () => { img.dispatchEvent(new dom.window.Event("error")); });
    assert.equal(view.el.querySelector("[data-avatar]").getAttribute("data-avatar"), "initials");
    assert.equal(view.el.textContent, "ОИ");
  } finally { await view.close(); }
  forgetPersonPhotos();
  const broken = await render(h(PersonAvatar, { name: "Олег Иванов", id: "oleg" }), { ui: {}, async personPhotos() { throw new Error("мост недоступен"); } });
  try { assert.equal(broken.el.textContent, "ОИ"); } finally { await broken.close(); }
  forgetPersonPhotos();
  const noBridge = await render(h(PersonAvatar, { name: "Олег Иванов", id: "oleg" }), { ui: {} });
  try { assert.equal(noBridge.el.textContent, "ОИ", "хост без метода фото — инициалы"); } finally { await noBridge.close(); }
});

test("не картинка из моста (SVG, пустые байты) не показывается", async () => {
  const host = { ui: {}, async personPhotos(ids) { return ids.map(id => id === "svg" ? { sha256: "c".repeat(64), type: "image/svg+xml", bytes: new TextEncoder().encode("<svg/>") } : { sha256: "d".repeat(64), type: "image/jpeg", bytes: new Uint8Array() }); } };
  const view = await render(h("div", null, h(PersonAvatar, { name: "Svg", id: "svg" }), h(PersonAvatar, { name: "Пусто", id: "empty" })), host);
  try { assert.equal(view.el.querySelectorAll("img").length, 0); } finally { await view.close(); }
});

test("CSP фрейма: картинки только blob:, сеть закрыта", async () => {
  const html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.ok(policy, "политика есть в app.txt");
  const directives = new Map(policy.split(";").map(part => part.trim().split(/\s+/)).filter(p => p[0]).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives.get("img-src"), ["blob:"]);
  assert.deepEqual(directives.get("connect-src"), ["'none'"]);
  assert.deepEqual(directives.get("default-src"), ["'none'"]);
  for (const [name, values] of directives) for (const value of values) {
    assert.ok(!["*", "data:", "https:", "http:"].includes(value) && !/^https?:\/\//.test(value), `${name} не открывает сеть и data: (${value})`);
  }
});

// Вся цепочка с подставным сервером Mnemos: /v1/people/photos → селектор подключения (peoplePhotos) →
// оболочка (FramePersonPhotos: presigned GET, проверка типа и суммы) → мост host.personPhotos → blob: во фрейме.
const chain = await build({ stdin: { contents: 'export {NativeWriteSelector} from "./src/native-writer.ts"; export {MnemosAPI} from "./src/mnemos-api.ts"; export {FramePersonPhotos,framePhotos,forgetDownloadedPhotos} from "../workshop-frontend/src/framePersonPhotos.ts";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "workers", setup(b) { b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class RpcTarget {} export class RpcStub { constructor(t) { return t; } } export class WorkerEntrypoint {} export class DurableObject {}" })); } }] });
const { NativeWriteSelector, MnemosAPI, FramePersonPhotos, framePhotos, forgetDownloadedPhotos } = await import("data:text/javascript;base64," + Buffer.from(chain.outputFiles[0].text).toString("base64"));

test("цепочка фото: principal_id из principal_photo → мост → blob: во фрейме; сбой объясняется в консоли", async () => {
  const STORAGE = "https://objects.example";
  const sum = createHash("sha256").update(JPEG).digest("hex");
  const seen = [];
  const server = async (input, init = {}) => {
    const url = new URL(String(input)); seen.push(`${init.method ?? "GET"} ${url.origin}${url.pathname}`);
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1/whoami") return json({ subject: { tenant_id: "acme", user_id: "mnemos-owner" }, tenant_name: "Acme" });
    if (url.pathname === "/v1/people/photos") return json({ photos: [{ principal_id: "mnemos-owner", sha256_hex: sum, media_type: "image/jpeg", size_bytes: JPEG.byteLength, updated_at: "2026-09-25T10:00:00Z", url: `${STORAGE}/content/sha256/${sum}?X-Amz-Signature=1`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }] });
    if (url.origin === STORAGE && url.pathname.startsWith("/content/")) return new Response(JPEG, { status: 200 });
    return new Response(null, { status: 404 });
  };
  const api = new MnemosAPI("https://mnemos.example", async () => "token", server);
  const selector = new NativeWriteSelector({ whoAmI: () => api.whoAmI(), listPersonPhotos: () => api.listPersonPhotos() }, {});
  // Ключ «своего» фото в оболочке — тот же principal_id, что и в списке фото сервера.
  assert.equal(await selector.reviewerIdentity(), "mnemos-owner");
  forgetDownloadedPhotos(); forgetPersonPhotos();
  const source = new FramePersonPhotos(selector, STORAGE, { fetch: server });
  const host = { ui: {}, personPhotos: ids => framePhotos(source, ids) };
  const view = await render(h("div", null, h(PersonAvatar, { name: "Александр Егоров", id: "mnemos-owner" }), h(PersonAvatar, { name: "Иван Смирнов", id: "ivan" })), host);
  try {
    const [owner, ivan] = view.el.querySelectorAll("[data-avatar]");
    assert.equal(owner.getAttribute("data-avatar"), "photo", "у владельца фото из Mnemos");
    assert.match(owner.querySelector("img").getAttribute("src"), /^blob:/);
    assert.equal(ivan.getAttribute("data-avatar"), "initials");
    assert.deepEqual(seen.filter(s => s.startsWith("GET https://objects")), [`GET ${STORAGE}/content/sha256/${sum}`], "одно скачивание по presigned GET");
  } finally { await view.close(); }

  // Байты, не совпавшие с суммой, фрейму не отдаются, а причина уходит в консоль отладочной строкой.
  forgetDownloadedPhotos(); forgetPersonPhotos();
  const lines = []; const debug = console.debug; console.debug = (...args) => lines.push(args.join(" "));
  try {
    const tampered = new FramePersonPhotos(selector, STORAGE, { fetch: async (input, init) => new URL(String(input)).origin === STORAGE ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 9]), { status: 200 }) : server(input, init) });
    assert.deepEqual(await framePhotos(tampered, ["mnemos-owner"]), [null]);
    assert.ok(lines.some(line => line.includes("mnemos-owner") && line.includes("сумма")), `причина в консоли: ${lines.join(" | ")}`);
  } finally { console.debug = debug; }
});

test("сторож: кружки с инициалами людей рисует только PersonAvatar", async () => {
  const dir = new URL("../app-react/", import.meta.url);
  // Приём самодельных инициалов: имя режется на слова и берётся первая буква каждого.
  const initials = /split\(\s*\/\\s\+\/\s*\)[\s\S]{0,120}?\.map\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\s*\[0\]/;
  assert.ok(initials.test(await readFile(new URL("PersonAvatar.tsx", dir), "utf8")), "сторож узнаёт приём в самом PersonAvatar");
  const offenders = [];
  for (const file of await readdir(dir)) {
    if (!/\.(tsx?|mjs)$/.test(file) || file === "PersonAvatar.tsx") continue;
    const source = await readFile(new URL(file, dir), "utf8");
    if (initials.test(source)) offenders.push(`${file}: первые буквы слов имени`);
    if (/\binitialsOf\(|\bpersonInitials\(/.test(source)) offenders.push(`${file}: инициалы вне PersonAvatar`);
    if (/function (Initials|Avatar)\b/.test(source)) offenders.push(`${file}: свой компонент кружка человека`);
  }
  assert.deepEqual(offenders, []);
});

after(() => { console.debug = quietDebug; dom.window.close(); for (const channel of channels) { channel.port1.close(); channel.port2.close(); } globalThis.MessageChannel = OriginalMessageChannel; });
