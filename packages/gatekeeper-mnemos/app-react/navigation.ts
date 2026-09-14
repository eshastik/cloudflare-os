/** Названия самостоятельных страниц Mnemos. Идентификаторы сохраняются в прямых ссылках. */
export const sections = {
  "my-work": { title: "Входящие", description: "Поручения, ответы и работа, которая ждёт вашего внимания." },
  projects: { title: "Проекты", description: "Материалы, участники и решения по каждому проекту." },
  documents: { title: "Материалы", description: "Документы организации, личные черновики и опубликованные версии." },
  approvals: { title: "Согласования", description: "Проверьте изменения в своей предметной области и примите решение." },
  sources: { title: "Источники", description: "Подключите почту, CRM, диски и другие рабочие системы." },
  agents: { title: "Агенты", description: "Помощники команды, их задачи и разрешения." },
  organization: { title: "Организация", description: "Правила работы, состояние системы и журнал действий." },
  people: { title: "Люди и доступ", description: "Сотрудники и их права по проектам, областям знаний и действиям." },
  intake: { title: "Приём данных", description: "Загрузите материалы организации и проверьте их распределение." },
  templates: { title: "Рабочие шаблоны", description: "Повторяющиеся задачи и документы команды." },
  analytics: { title: "Обзор работы", description: "Состояние проектов, расходы и качество результатов." },
} as const;
export type SectionId = keyof typeof sections;
export function resolveSection(value: string): SectionId | null {
  return Object.hasOwn(sections, value) ? value as SectionId : null;
}
