// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { RpcStub, RpcTarget } from "capnweb";
import type { AiChatAuthorInfo, AuthenticatedApi } from "@gadgets/workshop-shared/api";
import { accentShades, type AppearancePreference } from "@gadgets/workshop-shared/accent-theme";
import { AuthProvider } from "./AuthContext";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { prepareForLogout } from "./authNavigation";
import { readCachedAppearance } from "./theme";

// Аккаунты на «сервере»: общие для всех браузеров, в отличие от localStorage.
let server: Map<string, AppearancePreference | null>;
let saves: { user: string; value: AppearancePreference }[];
let storage: Map<string, string>;
let root: Root | undefined;
let container: HTMLDivElement;
const stubs: RpcStub<AuthenticatedApi>[] = [];

function freshBrowser() {
  storage = new Map();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k), clear: () => storage.clear() } });
  document.documentElement.style.cssText = "";
  document.documentElement.removeAttribute("data-mode");
}
beforeEach(() => {
  server = new Map(); saves = [];
  freshBrowser();
  window.matchMedia = vi.fn<Window["matchMedia"]>().mockReturnValue({ matches: false, media: "", onchange: null, addListener: vi.fn<() => void>(), removeListener: vi.fn<() => void>(), dispatchEvent: vi.fn<() => boolean>().mockReturnValue(true), addEventListener: vi.fn<() => void>(), removeEventListener: vi.fn<() => void>() });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  if (root) await React.act(async () => root!.unmount());
  root = undefined; container.remove();
  for (const stub of stubs.splice(0)) stub[Symbol.dispose]();
});

function session(user: string, answer?: () => Promise<unknown>) {
  class Account extends RpcTarget {
    whoami(): AiChatAuthorInfo { return { type: "user", id: user, name: user }; }
    amIAdmin() { return false; }
    getAppearance() { return answer ? answer() : server.get(user) ?? null; }
    setAppearance(value: AppearancePreference) { saves.push({ user, value }); server.set(user, value); }
  }
  const stub = new RpcStub(new Account()) as unknown as RpcStub<AuthenticatedApi>;
  stubs.push(stub);
  return stub;
}

function Controls() {
  const t = useTheme();
  return <><button onClick={() => t.setAccentChoice("blue")}>Голубой</button><button onClick={() => t.setThemeMode("light")}>Светлая</button></>;
}
const settle = () => React.act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });
async function show(content: React.ReactNode) {
  root ??= createRoot(container);
  await React.act(async () => root!.render(<ThemeProvider deploymentAccentColor="">{content}</ThemeProvider>));
  await settle();
}
const signedIn = (api: RpcStub<AuthenticatedApi>) => <AuthProvider authenticatedApi={api} onLogout={() => {}}><Controls /></AuthProvider>;
const brand = () => document.documentElement.style.getPropertyValue("--color-kumo-brand");
const mode = () => document.documentElement.getAttribute("data-mode");
const click = (text: string) => React.act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === text)!.click());

it("на новом устройстве с пустым браузером оформление после входа берётся из аккаунта", async () => {
  server.set("alice", { accent: "plum", themeMode: "dark" });
  await show(null);
  expect(brand()).toBe("#21664f");
  await show(signedIn(session("alice")));
  expect(brand()).toBe(accentShades("#705575").brand);
  expect(mode()).toBe("dark");
  expect(readCachedAppearance()).toEqual({ user: "alice", appearance: { accent: "plum", themeMode: "dark" } });
  expect(saves).toEqual([]);
});

it("выбор прежней версии из браузера переносится в пустой аккаунт один раз", async () => {
  storage.set("mnemos:accent-choice", "red"); storage.set("gadgets:theme-mode", "dark");
  await show(null);
  expect(brand()).toBe("#ac3443");
  await show(signedIn(session("alice")));
  expect(saves).toEqual([{ user: "alice", value: { accent: "red", themeMode: "dark" } }]);
  expect(storage.has("mnemos:accent-choice")).toBe(false);
  expect(storage.has("gadgets:theme-mode")).toBe(false);
  expect(readCachedAppearance().user).toBe("alice");
});

it("выбор в аккаунте важнее старого выбора браузера и не перезаписывается им", async () => {
  storage.set("mnemos:accent-choice", "red");
  server.set("alice", { accent: "gold", themeMode: null });
  await show(signedIn(session("alice")));
  expect(brand()).toBe(accentShades("#86620b").brand);
  expect(saves).toEqual([]);
});

it("смена цвета и темы пишется в аккаунт и видна на другом устройстве", async () => {
  await show(signedIn(session("alice")));
  await click("Голубой"); await click("Светлая"); await settle();
  expect(server.get("alice")).toEqual({ accent: "blue", themeMode: "light" });
  await React.act(async () => root!.unmount()); root = undefined;
  freshBrowser();
  await show(signedIn(session("alice")));
  expect(brand()).toBe("#176b9a");
  expect(mode()).toBe("light");
});

it("выбор до ответа сервера не затирается поздним ответом", async () => {
  let release!: (value: unknown) => void;
  const late = new Promise(r => { release = r; });
  await show(signedIn(session("alice", () => late)));
  await click("Голубой"); await settle();
  await React.act(async () => release({ accent: "red", themeMode: null })); await settle();
  expect(brand()).toBe("#176b9a");
  expect(server.get("alice")).toEqual({ accent: "blue", themeMode: null });
});

it("недопустимый ответ сервера не применяется как CSS", async () => {
  await show(signedIn(session("alice", async () => ({ accent: "url(https://evil.example)", themeMode: "dark" }))));
  expect(brand()).toBe("#21664f");
  expect(mode()).toBe("light");
});

it("кэш одного человека не применяется и не переносится другому в том же браузере", async () => {
  server.set("alice", { accent: "plum", themeMode: "dark" });
  await show(signedIn(session("alice")));
  expect(brand()).toBe(accentShades("#705575").brand);
  // Без выхода (истёк сеанс): в браузере остался кэш Алисы, входит Боб с пустым аккаунтом.
  await show(signedIn(session("bob")));
  expect(brand()).toBe("#21664f");
  expect(mode()).toBe("light");
  expect(server.get("bob")).toBeUndefined();
  expect(readCachedAppearance()).toEqual({ user: "bob", appearance: { accent: null, themeMode: null } });
});

it("выход очищает кэш и возвращает оформление установки", async () => {
  server.set("alice", { accent: "plum", themeMode: "dark" });
  await show(signedIn(session("alice")));
  await React.act(async () => prepareForLogout());
  await show(null);
  expect(storage.has("mnemos:appearance")).toBe(false);
  expect(brand()).toBe("#21664f");
  expect(mode()).toBe("light");
});
