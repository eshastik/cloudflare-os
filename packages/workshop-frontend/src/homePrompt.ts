import { MAX_GATEKEEPER_APP_PROMPT_LENGTH } from "./gatekeeperAppNavigation";
import type { ChatProjectContext } from "@gadgets/workshop-shared/api";
import type { ChatProject } from "@gadgets/workshop-shared/code-work";

export function homePromptFromSearch(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prompt = value.trim();
  if (!prompt || prompt.length > MAX_GATEKEEPER_APP_PROMPT_LENGTH) return undefined;
  return prompt;
}

// «Начать беседу» со страницы проекта закрепляет этот проект за беседой.
export function homeProjectFromSearch(value: unknown): ChatProjectContext | undefined {
  if(!value||typeof value!=='object')return undefined;
  const {accountId,projectId,title}=value as Record<string,unknown>;
  if(!Number.isSafeInteger(accountId)||Number(accountId)<0||typeof projectId!=='string'||!projectId.trim()||projectId.length>256||typeof title!=='string'||!title.trim()||title.length>256)return undefined;
  const project: ChatProject = {accountId:accountId as number,projectId,title:title.trim(),pinnedBy:"user"};
  return {accountId:project.accountId,projectId,title:project.title,projects:[project]};
}

/** Контекст новой беседы из набора чипов; одиночные поля — первый проект (для старых читателей). */
export function projectContextFromProjects(projects: ChatProject[]): ChatProjectContext | undefined {
  const first = projects[0];
  if (!first) return undefined;
  return {accountId:first.accountId,projectId:first.projectId,title:first.title,projects};
}
