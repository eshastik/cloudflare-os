import type { AiChatMessage } from "@gadgets/workshop-shared/api";

/** Только сохранённые разрешённые наблюдения; текст сообщений агента не является источником контекста. */
export function corporateWorkContext(messages: readonly AiChatMessage[]): {projectName: string; resources: string[]}[] {
  const projects = new Map<string, Set<string>>();
  for (const message of messages) {
    if (message.type !== "action" || message.actionLog?.type !== "observation" || message.actionLog.state !== "approved") continue;
    const context = message.actionLog.description.workContext;
    if (!context || typeof context.projectName !== "string" || !context.projectName.trim()) continue;
    const resources = projects.get(context.projectName) ?? new Set<string>();
    if (typeof context.resourceName === "string" && context.resourceName.trim()) resources.add(context.resourceName);
    projects.set(context.projectName, resources);
  }
  return [...projects].map(([projectName, resources]) => ({projectName, resources: [...resources]}));
}
