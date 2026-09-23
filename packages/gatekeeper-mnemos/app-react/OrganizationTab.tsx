import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import type { MemoryData } from "./data.ts";
import { LegacySwitch, useLegacySection, type LegacySection } from "./legacy.tsx";
import { Block, Notice, Row, RowList, RowText, Select } from "./ui.tsx";
import { OrganizationSharingSettings } from "./ProjectSharing.tsx";

interface SectionItem { title: string; note: string; section: LegacySection; capability?: string }

const OBSERVABILITY: SectionItem[] = [
  { title: "Метрики платформы", note: "публикации, входы, готовность интерфейса, внешние проверки", capability: "platform.metrics.read", section: { kind: "metrics" } },
  { title: "Предупреждения политики", note: "загрузки, нарушившие правила; рассмотрение сохраняет комментарий", capability: "principal.manage", section: { kind: "policyAlerts" } },
  { title: "Ответственные за сигналы", note: "кто отвечает за каждый сигнал состояния платформы", capability: "principal.manage", section: { kind: "signalOwners" } },
  { title: "Уведомления платформы", note: "входящие сигналы ответственным", capability: "platform.metrics.read", section: { kind: "signalInbox" } },
  { title: "Журнал операций", note: "попытки действий с результатом и исполнителем", capability: "principal.manage", section: { kind: "operationAudit" } },
];
const MAINTENANCE: SectionItem[] = [
  { title: "Массовый пересчёт индекса", note: "план пересчёта по проектам с паузой и продолжением", section: { kind: "reindexBatch" } },
  { title: "Проверка поиска", note: "эталонные запросы и найденные документы", section: { kind: "searchEvaluation" } },
  { title: "Оценка ответа", note: "разбор ответа агента по источникам", section: { kind: "answerEvaluation" } },
  { title: "Состав групп и ролей", note: "группы, функциональные роли и их участники", capability: "principal.manage", section: { kind: "roleMembership" } },
];

export default function OrganizationTab({ data }: { data: MemoryData }) {
  const legacy = useLegacySection();
  const [profileProject, setProfileProject] = useState("");
  const chosen = data.projects.find(p => p.id === profileProject) ?? data.projects[0];

  const available=(entry:SectionItem)=>entry.capability ? data.identity?.capabilities?.includes(entry.capability) : data.projects.length>0;
  const observability=OBSERVABILITY.filter(available), maintenance=MAINTENANCE.filter(available);
  const item = (entry: SectionItem) => (
    <Row key={entry.title}>
      <RowText title={entry.title} note={entry.note} />
      <Button variant="secondary" size="sm" onClick={() => legacy.open(entry.section, entry.title)}>Открыть: {entry.title}</Button>
    </Row>
  );

  return (
    <LegacySwitch state={legacy}>
      <section aria-label="Организация">
        <p className="mt-0 mb-4 text-[12px] text-kumo-subtle">Показаны разделы по вашим текущим полномочиям. Доступ к данным дополнительно проверяется при каждом действии.</p>
        {observability.length > 0 && <Block title="Наблюдаемость" count={observability.length}>
          <RowList>{observability.map(item)}</RowList>
        </Block>}
        {(maintenance.length > 0 || !!chosen) && <Block title="Обслуживание" count={maintenance.length + (chosen ? 1 : 0)}>
          <RowList>
            {maintenance.map(item)}
            {chosen && <Row>
              <RowText title="Пересчитать профиль проекта" note="профиль распределения документов по действующим правилам; может включать платную обработку" />
              <Select aria-label="Проект профиля" value={chosen?.id ?? ""} onChange={e => setProfileProject(e.target.value)}>
                {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Button variant="secondary" size="sm" disabled={!chosen} onClick={() => chosen && legacy.open({ kind: "centroid", project: chosen.id, name: chosen.name }, `Профиль проекта «${chosen.name}»`)}>Открыть: Пересчитать профиль проекта</Button>
            </Row>}
          </RowList>
          {data.projects.length === 0 && !data.projectsLoading && <Notice>Проектов нет: профиль пересчитывать не для чего.</Notice>}
        </Block>}
        {data.identity?.capabilities?.includes("principal.manage") && <details aria-label="Дополнительно" className="mb-6">
          <summary className="cursor-pointer py-1 text-[15px] font-semibold text-kumo-strong">Дополнительно</summary>
          <p className="mt-2 mb-2 text-[12px] text-kumo-subtle">Правила проектов: кто их создаёт и как ими делятся с отделом и организацией.</p>
          <OrganizationSharingSettings />
        </details>}
      </section>
    </LegacySwitch>
  );
}
