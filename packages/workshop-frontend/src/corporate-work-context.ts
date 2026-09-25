import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import { looksLikeId } from "@gadgets/workshop-shared/code-work";

/** Только сохранённые разрешённые наблюдения; текст сообщений агента не является источником контекста. */
export function corporateWorkContext(messages: readonly AiChatMessage[]): {projectName: string; resources: string[]}[] {
  return corporateSources(messages).map(({projectName, documents}) => ({projectName, resources: documents.map(document => document.name)}));
}

export type SourceDocument = { name: string; documentId?: string };
export type SourceProject = {
  projectName: string;
  /** Для ссылки на проект; есть, если наблюдение его назвало. */
  projectId?: string;
  resourceTitle?: string;
  documents: SourceDocument[];
  /** Сколько раз агент искал или смотрел папки в проекте, не открывая документ. */
  searches: number;
};

/**
 * Использованные материалы беседы: проекты и открытые документы по наблюдениям «Материалы Mnemos».
 * Идентификатор проекта берётся из самого итога или, в старых беседах, из предшествующего ему
 * наблюдения чтения («Проект «…», запрос: …»).
 */
export function corporateSources(messages: readonly AiChatMessage[]): SourceProject[] {
  const projects = new Map<string, SourceProject>();
  let lastScopeId: string | undefined;
  for (const message of messages) {
    if (message.type !== "action" || message.actionLog?.type !== "observation" || message.actionLog.state !== "approved") continue;
    const description = message.actionLog.description;
    const context = description.workContext;
    if (!context) {
      const scopeId = description.activity?.scopeId ?? /^Проект «([^»]+)»/.exec(description.description)?.[1];
      if (scopeId && looksLikeId(scopeId)) lastScopeId = scopeId;
      continue;
    }
    if (typeof context.projectName !== "string" || !context.projectName.trim()) continue;
    const project = projects.get(context.projectName) ?? { projectName: context.projectName, documents: [], searches: 0, resourceTitle: message.actionLog.resourceTitle };
    project.projectId ??= description.activity?.scopeId ?? lastScopeId;
    const resource = typeof context.resourceName === "string" ? context.resourceName.trim() : "";
    if (resource) {
      const documentId = description.activity?.items?.[0]?.documentId;
      const known = project.documents.find(document => document.name === resource);
      if (!known) project.documents.push({ name: resource, ...(documentId ? { documentId } : {}) });
      else if (!known.documentId && documentId) known.documentId = documentId;
    } else project.searches += 1;
    projects.set(context.projectName, project);
    lastScopeId = undefined;
  }
  return [...projects.values()];
}

/**
 * Во скольких ходах агента (отрезках между сообщениями человека) есть материалы из corporateSources.
 * Если ход один, его собственный список источников уже показывает то же самое.
 */
export function sourceTurnCount(messages: readonly AiChatMessage[]): number {
  const turns = new Set<number>();
  let turn = 0;
  for (const message of messages) {
    if (message.type === "message" && message.author.type === "user") { turn += 1; continue; }
    if (message.type !== "action" || message.actionLog?.type !== "observation" || message.actionLog.state !== "approved") continue;
    const projectName = message.actionLog.description.workContext?.projectName;
    if (typeof projectName === "string" && projectName.trim()) turns.add(turn);
  }
  return turns.size;
}
