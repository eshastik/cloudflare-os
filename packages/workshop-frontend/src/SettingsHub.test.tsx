// @vitest-environment jsdom
// «Настройки» — только личное; организационное живёт в «Управлении».
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { expect, it, vi } from "vitest";

vi.mock("./components/AppearanceSettings", () => ({ default: () => <div>Окно оформления</div> }));
import SettingsHub from "./SettingsHub";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("показывает профиль и оформление, без организационных разделов и моделей", async () => {
  const route = createRootRoute({ component: SettingsHub });
  const pages = ["/profile", "/outputs"].map(path => createRoute({ getParentRoute: () => route, path }));
  const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/"] }), routeTree: route.addChildren(pages) });
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
  try {
    await React.act(async () => root.render(<RouterProvider router={router} />));
    const groups = [...el.querySelectorAll("section")].map(s => s.getAttribute("aria-label"));
    expect(groups).toEqual(["Личное"]);
    const text = el.textContent ?? "";
    expect(text).toContain("Профиль");
    expect(text).toContain("Оформление");
    for (const hidden of ["Организация", "Дополнительно", "Модели", "Согласования", "Источники", "Исполнители", "Люди и доступ", "Приём данных", "Почта, календари и файлы", "Свод организаций", "Настройки платформы"]) {
      expect(text).not.toContain(hidden);
    }
    const appearance = [...el.querySelectorAll("button")].find(b => b.textContent?.includes("Оформление"))!;
    await React.act(async () => appearance.click());
    expect(el.textContent).toContain("Окно оформления");
  } finally { await React.act(async () => root.unmount()); el.remove(); }
});
