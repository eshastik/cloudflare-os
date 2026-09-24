// @vitest-environment jsdom
// «Настройки» — одна страница без вложенных вкладок: профиль, тема, свои результаты, выход.
// Организационные разделы живут в меню администратора; у администратора здесь только служебные
// страницы оболочки (модели, подключения сервисов, настройки платформы).
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isAdmin: false,
  logout: vi.fn<() => void>(),
  setThemeMode: vi.fn<(mode: string) => void>(),
}));
vi.mock("./components/AppearanceSettings", () => ({ default: () => <div>Окно оформления</div> }));
vi.mock("./AuthContext", () => ({
  useAuthenticatedApi: () => ({ authenticatedApi: {}, currentUser: { type: "user", id: "u1", name: "Мария Иванова" }, isAdmin: state.isAdmin, logout: state.logout }),
}));
vi.mock("./useAvatar", () => ({ useAvatar: () => null }));
vi.mock("./ThemeContext", () => ({ useTheme: () => ({ themeMode: "system", setThemeMode: state.setThemeMode }) }));
import SettingsHub from "./SettingsHub";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderHub() {
  const route = createRootRoute({ component: SettingsHub });
  const pages = ["/profile", "/outputs", "/providers", "/gatekeepers", "/admin"].map(path => createRoute({ getParentRoute: () => route, path }));
  const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/"] }), routeTree: route.addChildren(pages) });
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
  await React.act(async () => root.render(<RouterProvider router={router} />));
  return { el, done: async () => { await React.act(async () => root.unmount()); el.remove(); } };
}

it("сотруднику: профиль, тема, результаты и выход — без организационных разделов и моделей", async () => {
  state.isAdmin = false;
  const { el, done } = await renderHub();
  try {
    const sections = [...el.querySelectorAll("section")].map(s => s.getAttribute("aria-label"));
    expect(sections).toEqual(["Профиль", "Оформление", "Работа"]);
    const text = el.textContent ?? "";
    expect(text).toContain("Мария Иванова");
    expect(text).toContain("МИ");
    expect(text).not.toContain("u1");
    for (const hidden of ["Организация", "Дополнительно", "Модели", "Согласования", "Источники", "Исполнители", "Люди и доступ", "Приём данных", "Почта, календари и файлы", "Свод организаций", "Настройки платформы"]) {
      expect(text).not.toContain(hidden);
    }
    const radios = [...el.querySelectorAll('[role="radio"]')];
    expect(radios.map(r => r.textContent)).toEqual(["Светлая", "Тёмная", "Как в системе"]);
    expect(radios.find(r => r.getAttribute("aria-checked") === "true")?.textContent).toBe("Как в системе");
    await React.act(async () => (radios[1] as HTMLButtonElement).click());
    expect(state.setThemeMode).toHaveBeenCalledWith("dark");
    const accent = [...el.querySelectorAll("button")].find(b => b.textContent === "Цвет акцента")!;
    await React.act(async () => accent.click());
    expect(el.textContent).toContain("Окно оформления");
    const logout = [...el.querySelectorAll("button")].find(b => b.textContent === "Выйти")!;
    await React.act(async () => logout.click());
    expect(state.logout).toHaveBeenCalled();
    expect(el.querySelector('a[href="/profile"]')?.textContent).toBe("Изменить");
  } finally { await done(); }
});

it("администратору — ещё модели, подключения сервисов и настройки платформы", async () => {
  state.isAdmin = true;
  const { el, done } = await renderHub();
  try {
    const links = [...el.querySelectorAll("a")].map(a => a.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/providers", "/gatekeepers", "/admin"]));
  } finally { await done(); state.isAdmin = false; }
});
