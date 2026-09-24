import type { WhoAmI } from "./mnemos-api.ts";

type Section = { id: string; title: string; group: "work" | "manage"; count?: number };

/** Разделы меню по ревизии интерфейса 24.09.2026. Навигация отражает свежие полномочия;
 * каждую операцию по-прежнему проверяет API. inbox — всё, что ждёт решения человека,
 * включая согласования: отдельного раздела согласований больше нет. */
export function managementSections(identity: WhoAmI, inbox?: number): Section[] {
  const sections: Section[] = [
    { id: "my-work", title: "Входящие", group: "work", ...(inbox === undefined ? {} : { count: inbox }) },
    { id: "projects", title: "Проекты", group: "work" },
    { id: "documents", title: "Материалы", group: "work" },
  ];
  const roles = identity.roles;
  if (roles?.department_head || roles?.project_responsible) sections.push({ id: "team", title: "Мой отдел", group: "work" });
  const capabilities = identity.capabilities ?? [];
  if (capabilities.includes("principal.manage")) sections.push(
    { id: "people", title: "Люди и отделы", group: "manage" },
    { id: "rules", title: "Правила", group: "manage" },
    { id: "connections", title: "Подключения", group: "manage" },
    { id: "agents", title: "Агенты и расходы", group: "manage" },
    { id: "journal", title: "Журнал и состояние", group: "manage" },
  );
  // Наблюдатель состояния без управления людьми видит только журнал и состояние.
  else if (capabilities.includes("platform.metrics.read")) sections.push({ id: "journal", title: "Журнал и состояние", group: "manage" });
  return sections;
}
