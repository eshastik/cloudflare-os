// Аватары людей во встроенном приложении: фото через мост оболочки (blob:), инициалы при отсутствии
// или ошибке, один вызов моста на экран, узкая CSP и сторож против самодельных кружков с инициалами.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

after(() => { dom.window.close(); for (const channel of channels) { channel.port1.close(); channel.port2.close(); } globalThis.MessageChannel = OriginalMessageChannel; });
