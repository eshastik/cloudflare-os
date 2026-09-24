// @vitest-environment jsdom
// Меню по ролям: сотрудник, руководитель, администратор (редизайн по макету 24.09.2026).
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import type { GatekeeperAppInfo } from "@gadgets/workshop-shared/api";
import { buildRoleNavigation, navigationRole } from "./roleNavigation";
import { SidebarManagement } from "./components/AppShell/SidebarRoleNav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Разделы по договору с приложением (managementSections). Приложение по-прежнему отдаёт
// «documents», но в меню его нет: файлы ищутся поиском ⌘K.
const WORK = ["my-work", "projects", "documents"];
const MENU_WORK = ["my-work", "projects"];
const ADMIN = ["people", "rules", "connections", "agents", "journal"];
function app(extra: { id: string; group?: "work" | "manage" }[] = [], counts: Record<string, number> = {}): GatekeeperAppInfo {
  const sections = [...WORK.map(id => ({ id, group: "work" as const })), ...extra];
  return {
    id: "mnemos", title: "Mnemos", accountId: 7,
    sections: sections.map(({ id, group }) => ({ id, title: id, group, ...(counts[id] !== undefined ? { count: counts[id] } : {}) })),
  } as GatekeeperAppInfo;
}
const manage = (...ids: string[]) => ids.map(id => ({ id, group: "manage" as const }));
const admin = () => app(manage(...ADMIN));
const labels = (links: { label: string }[]) => links.map(l => l.label);

describe("роль по разделам приложения", () => {
  it("сотрудник: Входящие с числом и Проекты — и больше ничего, «Материалов» нет", () => {
    const nav = buildRoleNavigation([app([], { "my-work": 5 })]);
    expect(nav.role).toBe("employee");
    expect(labels(nav.primary)).toEqual(["Входящие", "Проекты"]);
    expect(nav.primary[0].count).toBe(5);
    expect(nav.manager).toEqual([]);
    expect(nav.management).toEqual([]);
  });

  it("руководитель видит «Мой отдел», но не «Управление»", () => {
    const nav = buildRoleNavigation([app(manage("team"))]);
    expect(nav.role).toBe("manager");
    expect(labels(nav.primary)).toEqual(["Входящие", "Проекты"]);
    expect(labels(nav.manager)).toEqual(["Мой отдел"]);
    expect(nav.management).toEqual([]);
  });

  it("администратор: ровно пять пунктов управления словами договора, без вложенных ссылок", () => {
    const nav = buildRoleNavigation([admin()]);
    expect(nav.role).toBe("admin");
    expect(labels(nav.management)).toEqual(["Люди и отделы", "Правила", "Подключения", "Агенты и расходы", "Журнал и состояние"]);
    expect(nav.management.map(l => l.section)).toEqual(ADMIN);
    expect(nav.management.every(l => l.appId === "mnemos" && l.accountId === 7)).toBe(true);
    expect(nav.management.some(l => l.label === "Модели" || l.to === "/providers")).toBe(false);
  });

  it("пункт без раздела в приложении не показывается", () => {
    const nav = buildRoleNavigation([app(manage("people", "journal"))]);
    expect(labels(nav.management)).toEqual(["Люди и отделы", "Журнал и состояние"]);
    const bare = buildRoleNavigation([{ id: "mnemos", title: "Mnemos", accountId: 7, sections: [{ id: "my-work", title: "Входящие" }] } as GatekeeperAppInfo]);
    expect(labels(bare.primary)).toEqual(["Входящие"]);
  });

  it("раздел с id управления, но в повседневной группе, в «Управление» не попадает", () => {
    expect(navigationRole([app([{ id: "agents", group: "work" }])])).toBe("employee");
    expect(buildRoleNavigation([app([{ id: "agents", group: "work" }])]).management).toEqual([]);
  });

  it("старые разделы не дают пунктов меню", () => {
    const nav = buildRoleNavigation([app([
      { id: "approvals", group: "work" }, { id: "sources", group: "work" }, { id: "templates", group: "work" },
      { id: "analytics", group: "work" }, ...manage("intake", "organization"),
    ], { approvals: 3 })]);
    expect(nav.role).toBe("employee");
    const all = [...nav.primary, ...nav.manager, ...nav.management];
    expect(all.map(l => l.section)).toEqual(MENU_WORK);
  });

  it("две организации одного приложения различаются подписью", () => {
    const a = { ...app(), accountId: 1, accountName: "Альфа" } as GatekeeperAppInfo;
    const b = { ...app(), accountId: 2, accountName: "Бета" } as GatekeeperAppInfo;
    const nav = buildRoleNavigation([a, b]);
    expect(labels(nav.primary)).toContain("Входящие — Альфа");
    expect(labels(nav.primary)).toContain("Входящие — Бета");
  });
});

describe("разделы администратора в меню", () => {
  it("видны сразу плоским списком из пяти ссылок: без раскрывающегося пункта, «Моделей» и «Тонких настроек»", async () => {
    const nav = buildRoleNavigation([admin()]);
    const route = createRootRoute({ component: () => <SidebarManagement management={nav.management} collapsed={false} /> });
    const child = createRoute({ getParentRoute: () => route, path: "/gatekeepers/$appId" });
    const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/"] }), routeTree: route.addChildren([child]) });
    const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
    try {
      await React.act(async () => root.render(<RouterProvider router={router} />));
      expect(el.querySelectorAll("button")).toHaveLength(0);
      const links = [...el.querySelectorAll("a")].map(a => a.textContent);
      expect(links).toEqual(["Люди и отделы", "Правила", "Подключения", "Агенты и расходы", "Журнал и состояние"]);
      expect(el.textContent).not.toContain("Модели");
      expect(el.textContent).not.toContain("Тонкие настройки");
      const people = [...el.querySelectorAll("a")].find(a => a.textContent === "Люди и отделы")!;
      expect(people.getAttribute("href")).toBe("/gatekeepers/mnemos?section=people&account=7");
    } finally { await React.act(async () => root.unmount()); el.remove(); }
  });
});
