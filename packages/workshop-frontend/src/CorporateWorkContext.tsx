import { useMemo } from "react";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import { corporateWorkContext } from "./corporate-work-context";

/** Показывает историю реально использованных материалов, не обещая текущего доступа. */
export default function CorporateWorkContext({messages}: {messages: readonly AiChatMessage[]}) {
  const projects = useMemo(() => corporateWorkContext(messages), [messages]);
  if (!projects.length) return null;
  return <details className="mx-4 mb-2 rounded-xl border border-kumo-line bg-kumo-base px-3 py-2 text-[12px]" aria-label="Использованные материалы">
    <summary className="cursor-pointer font-medium text-kumo-default">Использованные материалы · {projects.map(project => project.projectName).join(", ")}</summary>
    <p className="my-2 text-kumo-subtle">Из загруженной истории разговора. Доступ проверяется при каждом обращении; эти записи не назначают права.</p>
    <ul className="m-0 space-y-2 pl-4">{projects.map(project => <li key={project.projectName}><strong>{project.projectName}</strong>{project.resources.length ? <ul className="pl-4">{project.resources.map(name => <li key={name}>{name}</li>)}</ul> : <span className="text-kumo-subtle"> · поиск по проекту</span>}</li>)}</ul>
  </details>;
}
