/** Разделы приложения по ревизии интерфейса 24.09.2026. Идентификаторы — часть адреса страницы. */
export const sections = {
  "my-work": { title: "Входящие", description: "Всё, что ждёт вашего решения: согласования, запросы доступа, работа агентов и вопросы по файлам." },
  projects: { title: "Проекты", description: "Ваши рабочие проекты и материалы." },
  documents: { title: "Материалы", description: "Документы организации, личные черновики и опубликованные версии." },
  team: { title: "Мой отдел", description: "Сотрудники отдела, проекты отдела и проекты, за которые вы отвечаете, и запросы на решение." },
  people: { title: "Люди и отделы", description: "Сотрудники, отделы, руководители и приглашения." },
  rules: { title: "Правила", description: "Правила организации: кто создаёт проекты, кому они видны и как ими делятся." },
  connections: { title: "Подключения", description: "Почта, календари, диски, код, базы данных и Telegram, из которых память получает материалы." },
  agents: { title: "Агенты и расходы", description: "Агенты организации, бюджеты проектов и расходы на работу агентов." },
  journal: { title: "Журнал и состояние", description: "Что происходило в организации и как работает система." },
} as const;
export type SectionId = keyof typeof sections;

/** Прежние адреса разделов ведут в новый раздел, а не на пустую страницу. */
export const REDIRECTS: Record<string, SectionId> = {
  approvals: "my-work", sources: "connections", templates: "journal", analytics: "agents", intake: "documents", organization: "rules",
};

export function resolveSection(value: string): SectionId | null {
  if (Object.hasOwn(sections, value)) return value as SectionId;
  return Object.hasOwn(REDIRECTS, value) ? REDIRECTS[value] : null;
}
