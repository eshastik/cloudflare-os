// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { accentShades } from "@gadgets/workshop-shared/accent-theme";

vi.mock("@cloudflare/kumo", async importOriginal => ({ ...(await importOriginal<object>()), useKumoToastManager: () => ({ add: () => {} }) }));
vi.mock("./components/format/AdminFormatsPanel", () => ({ default: () => null }));
const setAccentColor = vi.fn<(color: string) => Promise<void>>(async () => {});
const settings = { signupsEnabled: false, siteName: "Mnemos", instanceInstructions: "", announcement: "", banner: { text: "", color: "info" }, accentColor: "", resourceVendors: [], formats: [] };
// Один объект на все отрисовки, как у настоящего контекста: новый объект перезапускал бы загрузку.
const auth = { isAdmin: true, authenticatedApi: { getAdminApi: async () => ({ getSettings: async () => settings, setAccentColor }) } };
vi.mock("./AuthContext", () => ({ useAuthenticatedApi: () => auth }));

import AdminPage from "./AdminPage";
import { ThemeProvider } from "./ThemeContext";

let root: Root | undefined;
let container: HTMLDivElement;
const brand = () => document.documentElement.style.getPropertyValue("--color-kumo-brand");
const button = (text: string) => [...container.querySelectorAll("button")].find(el => el.textContent?.trim() === text)!;
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k), clear: () => values.clear() } });
  document.documentElement.style.cssText = "";
  window.matchMedia = vi.fn<Window["matchMedia"]>().mockReturnValue({ matches: false, media: "", onchange: null, addListener: vi.fn<() => void>(), removeListener: vi.fn<() => void>(), dispatchEvent: vi.fn<() => boolean>().mockReturnValue(true), addEventListener: vi.fn<() => void>(), removeEventListener: vi.fn<() => void>() });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
  container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => { if (root) await React.act(async () => root!.unmount()); root = undefined; container.remove(); setAccentColor.mockClear(); });

function Shell({ admin }: { admin: boolean }) { return <ThemeProvider deploymentAccentColor="">{admin ? <AdminPage /> : null}</ThemeProvider>; }
async function render(admin: boolean) { root ??= createRoot(container); await React.act(async () => root!.render(<Shell admin={admin} />)); await React.act(async () => { await new Promise(r => setTimeout(r, 0)); }); }

it("Настройки платформы не сбрасывают личный цвет: ни при открытии, ни после предпросмотра и ухода", async () => {
  window.localStorage.setItem("mnemos:accent-choice", "red");
  await render(true);
  expect(brand()).toBe("#ac3443");
  await React.act(async () => button("Синий").click());
  expect(brand()).toBe(accentShades("#3b82f6").brand);
  await render(false);
  expect(brand()).toBe("#ac3443");
});

it("Сохранённый общий цвет установки действует сразу у того, кто не выбирал личный", async () => {
  await render(true);
  expect(brand()).toBe("#21664f");
  await React.act(async () => button("Фиолетовый").click());
  const section = [...container.querySelectorAll("h2")].find(h => h.textContent === "Оформление")!.parentElement!;
  await React.act(async () => [...section.querySelectorAll("button")].find(b => b.textContent?.trim() === "Сохранить")!.click());
  expect(setAccentColor).toHaveBeenCalledWith("#7c3aed");
  await render(false);
  expect(brand()).toBe(accentShades("#7c3aed").brand);
});
