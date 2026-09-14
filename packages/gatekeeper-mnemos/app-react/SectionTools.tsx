import { Button } from "@cloudflare/kumo";
import { type LegacySection } from "./legacy.tsx";
import type { SectionId } from "./navigation.ts";

type Tool = {title:string; note:string; kind: Exclude<LegacySection, { project:string } | {binding:string}>["kind"]};
const tools: Partial<Record<SectionId, Tool[]>> = {
  "my-work": [{ title:"Аудио", note:"Запись и расшифровка рабочих сообщений", kind:"voice" }],
  projects: [{title:"Ресурсы проекта", note:"Связанные материалы и подготовка изменений",kind:"resourceMap"}],
  sources: [
    {title:"Перенос из Jira",note:"Задачи и структура проектов",kind:"jiraImport"},
    {title:"Перенос из Bitrix24",note:"Рабочие данные и подразделения",kind:"bitrixImport"},
  ],
  agents: [
    {title:"Ответы агентов",note:"Ответы и использованные источники",kind:"agentAnswers"},
    {title:"Качество агентов",note:"Оценка результатов работы",kind:"agentQuality"},
  ],
  analytics: [
    {title:"Обзор проектов",note:"Состояние проектов и сигналы, требующие внимания",kind:"signalsOverview"},
    {title:"Оценка данных проекта",note:"Проверка полноты и качества исходных данных",kind:"projectSignals"},
    {title:"Организация и клиенты",note:"Общая картина работы организации",kind:"businessOverview"},
    {title:"Расходы по проектам",note:"Фактические расходы и их состав",kind:"expenses"},
    {title:"Бюджеты",note:"Ограничения расходов по проектам",kind:"budget"},
  ],
};
export default function SectionTools({section, onOpen}:{section:SectionId;onOpen(section:LegacySection,title:string):void}) {
  const entries = tools[section] ?? [];
  if (!entries.length) return null;
  return <div className="mt-6">
    <div className="grid gap-3 sm:grid-cols-2">
      {entries.map(tool => <div key={tool.kind} className="rounded-lg border border-kumo-line p-4">
        <h2 className="m-0 text-sm font-medium">{tool.title}</h2>
        <p className="mt-1 mb-3 text-xs text-kumo-subtle">{tool.note}</p>
        <Button size="sm" variant="secondary" onClick={() => onOpen({kind:tool.kind},tool.title)}>Открыть</Button>
      </div>)}
    </div>
  </div>;
}
