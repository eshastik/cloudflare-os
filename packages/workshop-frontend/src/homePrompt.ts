import { MAX_GATEKEEPER_APP_PROMPT_LENGTH } from "./gatekeeperAppNavigation";

export function homePromptFromSearch(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prompt = value.trim();
  if (!prompt || prompt.length > MAX_GATEKEEPER_APP_PROMPT_LENGTH) return undefined;
  return prompt;
}

export function homeProjectFromSearch(value: unknown): import('@gadgets/workshop-shared/api').ChatProjectContext | undefined {
  if(!value||typeof value!=='object')return undefined;
  const {accountId,projectId,title}=value as Record<string,unknown>;
  if(!Number.isSafeInteger(accountId)||Number(accountId)<0||typeof projectId!=='string'||!projectId.trim()||projectId.length>256||typeof title!=='string'||!title.trim()||title.length>256)return undefined;
  return {accountId:accountId as number,projectId,title:title.trim()};
}
