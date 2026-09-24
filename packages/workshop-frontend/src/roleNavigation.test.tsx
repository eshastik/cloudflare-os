// @vitest-environment jsdom
// Меню по ролям: сотрудник, руководитель, администратор.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import type { GatekeeperAppInfo } from "@gadgets/workshop-shared/api";
import { buildRoleNavigation, navigationRole } from "./roleNavigation";
import { SidebarManagement } from "./components/AppShell/SidebarRoleNav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WORK = ["my-work", "approvals", "documents", "projects", "sources", "agents", "templates", "analytics"];
function app(extra: string[] = [], counts: Record<string, number> = {}): GatekeeperAppInfo {
  return {
    id: "mnemos", title: "Mnemos", accountId: 7,
    sections: [...WORK, ...extra].map(id => ({ id, title: id, ...(counts[id] !== undefined ? { count: counts[id] } : {}) })),
  } as GatekeeperAppInfo;
}
const labels = (links: { label: string }[]) => links.map(l => l.label);

describe("роль по разделам приложения", () => {
  it("сотрудник: Входящие, Проекты, Материалы — и больше ничего", () => {
    const nav = buildRoleNavigation([app()], false);
    expect(nav.role).toBe("employee");
    expect(labels(nav.primary)).toEqual(["Входящие", "Проекты", "Материалы"]);
    expect(nav.manager).toEqual([]);
    expect(nav.management).toEqual([]);
    expect(nav.fine).toEqual([]);
  });

  it("руководитель узнаётся по «Моему отделу» или решениям, которые ждут его в согласованиях", () => {
    expect(navigationRole([app(["team"])], false)).toBe("manager");
    expect(navigationRole([app([], { approvals: 2 })], false)).toBe("manager");
    expect(navigationRole([app([], { approvals: 0 })], false)).toBe("employee");
    const nav = buildRoleNavigation([app(["team"])], false);
    expect(labels(nav.primary)).toEqual(["Входящие", "Проекты", "Материалы"]);
    expect(labels(nav.manager)).toEqual(["Ждёт моего решения", "Мой отдел и проекты"]);
    expect(nav.management).toEqual([]);
  });

  it("администратор: «Управление» по полномочиям, тонкие настройки отдельно, без повторов", () => {
    const nav = buildRoleNavigation([app(["people", "intake", "organization"])], false);
    expect(nav.role).toBe("admin");
    expect(labels(nav.management)).toEqual(["Люди и доступ", "Проекты, журнал и состояние", "Данные", "Агенты и лимиты"]);
    expect(labels(nav.fine)).toEqual(["Источники", "Рабочие шаблоны", "Обзор работы"]);
    expect(nav.management.every(l => l.appId === "mnemos" && l.accountId === 7)).toBe(true);
    expect(nav.management.map(l => l.section)).toEqual(["people", "organization", "intake", "agents"]);
  });

  it("только метрики (organization без people) — тоже администратор, без «Людей и доступа»", () => {
    const nav = buildRoleNavigation([app(["organization"])], false);
    expect(nav.role).toBe("admin");
    expect(labels(nav.management)).toEqual(["Проекты, журнал и состояние", "Агенты и лимиты"]);
  });

  it("администратор платформы видит «Настройки платформы» в тонких настройках", () => {
    const nav = buildRoleNavigation([app()], true);
    expect(nav.role).toBe("admin");
    expect(nav.fine.at(-1)).toMatchObject({ label: "Настройки платформы", to: "/admin" });
  });

  it("две организации одного приложения различаются подписью", () => {
    const a = { ...app(), accountId: 1, accountName: "Альфа" } as GatekeeperAppInfo;
    const b = { ...app(), accountId: 2, accountName: "Бета" } as GatekeeperAppInfo;
    const nav = buildRoleNavigation([a, b], false);
    expect(labels(nav.primary)).toContain("Входящие — Альфа");
    expect(labels(nav.primary)).toContain("Входящие — Бета");
  });
});

describe("пункт «Управление» в меню", () => {
  it("свёрнут; раскрывается по щелчку, тонкие настройки раскрываются отдельно", async () => {
    const nav = buildRoleNavigation([app(["people", "organization"])], true);
    const route = createRootRoute({ component: () => <SidebarManagement management={nav.management} fine={nav.fine} collapsed={false} /> });
    const child = createRoute({ getParentRoute: () => route, path: "/gatekeepers/$appId" });
    const admin = createRoute({ getParentRoute: () => route, path: "/admin" });
    const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/"] }), routeTree: route.addChildren([child, admin]) });
    const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
    try {
      await React.act(async () => root.render(<RouterProvider router={router} />));
      expect(el.textContent).toContain("Управление");
      expect(el.textContent).not.toContain("Люди и доступ");
      const button = (text: string) => [...el.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
      await React.act(async () => button("Управление").click());
      expect(el.textContent).toContain("Люди и доступ");
      expect(el.textContent).toContain("Тонкие настройки");
      expect(el.textContent).not.toContain("Настройки платформы");
      await React.act(async () => button("Тонкие настройки").click());
      expect(el.textContent).toContain("Настройки платформы");
      const people = [...el.querySelectorAll("a")].find(a => a.textContent === "Люди и доступ")!;
      expect(people.getAttribute("href")).toBe("/gatekeepers/mnemos?section=people&account=7");
    } finally { await React.act(async () => root.unmount()); el.remove(); }
  });
});
