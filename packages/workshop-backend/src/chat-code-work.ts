// Работа с кодом в беседе: набор проектов, переход агента беседы в рабочее место, сообщения
// человека прямо в работу с кодом, «Что изменилось» и «Принять». Хранится в метаданных беседы.
import type {AiChatMetadata, AiChatStreamEvent, ChatCodeAcceptResult, ChatCodeChanges, ChatProjectChoice} from "@gadgets/workshop-shared/api";
import {chatProjects, displayName, validateChatProjects, type AgentStep, type ChatCodeWork, type ChatProject, type CodeWorkOutput} from "@gadgets/workshop-shared/code-work";
import type {CodeWorkReview, CodeWorkTarget} from "@gadgets/workshop-shared/gatekeeper";
import {codeWorkAlive, runCodeWorkTurn, type CodeWorkBackend} from "./code-work.js";

/** Подключение человека, через которое идёт работа с кодом (методы пользовательского DO). */
export interface CodeWorkUser {
  listChatProjects(): Promise<ChatProjectChoice[]>;
  codeWorkTarget(accountId: number, projectId: string): Promise<{title: string; code?: CodeWorkTarget} | null>;
  codeWorkStart(accountId: number, project: string, target: CodeWorkTarget, prompt: string): ReturnType<CodeWorkBackend["start"]>;
  codeWorkMessage(accountId: number, project: string, task: string, text: string): Promise<void>;
  codeWorkEvents(accountId: number, project: string, task: string, after: number, waitMs: number): ReturnType<CodeWorkBackend["events"]>;
  codeWorkAbort(accountId: number, project: string, task: string): Promise<void>;
  codeWorkInterrupt(accountId: number, project: string, task: string): Promise<void>;
  codeWorkChanges(accountId: number, project: string, task: string): ReturnType<CodeWorkBackend["changes"]>;
  codeWorkAccept(accountId: number, project: string, task: string, summary: string): Promise<CodeWorkReview>;
  codeWorkRevert(accountId: number, project: string, task: string, mergeRequest: number): Promise<CodeWorkReview>;
}

export interface ChatCodeWorkHost {
  chatMeta(chatId: number): AiChatMetadata | undefined;
  putChatMeta(meta: AiChatMetadata): void;
  /** Подключения человека, создавшего беседу (набор проектов принадлежит ему). */
  user(userId: string): CodeWorkUser;
  emit(chatId: number, event: AiChatStreamEvent): void;
}

const MAX_SUMMARY = 4000;

function backendFor(user: CodeWorkUser, accountId: number): CodeWorkBackend {
  return {
    start: (project, target, prompt) => user.codeWorkStart(accountId, project, target, prompt),
    message: (project, task, text) => user.codeWorkMessage(accountId, project, task, text),
    events: (project, task, after, waitMs) => user.codeWorkEvents(accountId, project, task, after, waitMs),
    abort: (project, task) => user.codeWorkAbort(accountId, project, task),
    interrupt: (project, task) => user.codeWorkInterrupt(accountId, project, task),
    changes: (project, task) => user.codeWorkChanges(accountId, project, task),
  };
}

function metaOrThrow(host: ChatCodeWorkHost, chatId: number): AiChatMetadata {
  let meta = host.chatMeta(chatId);
  if (!meta) throw new Error("Беседа не найдена.");
  return meta;
}

/** Набор проектов беседы: пишет создатель беседы (или первый, кто подключил проект). */
export function setChatProjects(host: ChatCodeWorkHost, chatId: number, userId: string, profileId: string, value: unknown): void {
  let meta = metaOrThrow(host, chatId);
  let projects = validateChatProjects(value);
  let creator = meta.projectContext?.creatorId;
  if (creator && creator !== userId) throw new Error("Проекты беседы меняет тот, кто начал беседу.");
  if (!projects.length) {
    if (meta.projectContext) meta.projectContext = {...meta.projectContext, projects: []};
  } else {
    let first = projects[0];
    meta.projectContext = {accountId: first.accountId, projectId: first.projectId, title: first.title, projects,
      creatorId: creator ?? userId, creatorProfileId: meta.projectContext?.creatorProfileId ?? profileId};
  }
  host.putChatMeta(meta);
}

/** Вернуть сообщения человека агенту беседы. */
export function leaveCodeWork(host: ChatCodeWorkHost, chatId: number): void {
  let meta = metaOrThrow(host, chatId);
  if (meta.codeWork?.foreground) { meta.codeWork = {...meta.codeWork, foreground: false}; host.putChatMeta(meta); }
}

/** Сообщение человека идёт прямо в работу с кодом, если она на переднем плане и жива. */
export function codeWorkForeground(meta: AiChatMetadata | undefined): boolean {
  return !!meta?.codeWork?.foreground && codeWorkAlive(meta.codeWork.state);
}

function pinProject(meta: AiChatMetadata, project: ChatProject, userId: string, profileId: string): void {
  let projects = chatProjects(meta.projectContext);
  if (projects.some(p => p.accountId === project.accountId && p.projectId === project.projectId)) return;
  projects = [...projects, project];
  let first = projects[0];
  meta.projectContext = {accountId: first.accountId, projectId: first.projectId, title: first.title, projects,
    creatorId: meta.projectContext?.creatorId ?? userId, creatorProfileId: meta.projectContext?.creatorProfileId ?? profileId};
}

export type CodeWorkRequest = {
  chatId: number;
  toolCallId: string;
  /** Текст задачи или сообщения для агента кода. */
  prompt: string;
  /** Проект задачи; для продолжения и вопросов берётся проект текущей работы. */
  projectId?: string;
  /** Только продолжить живую сессию (вопрос агента беседы или сообщение человека). */
  continueOnly?: boolean;
  /** Кто ведёт беседу сейчас: чьи подключения использовать, если у беседы ещё нет создателя. */
  userId: string;
  profileId: string;
  signal: AbortSignal;
};

/** Один ход работы с кодом; шаги и текст стримятся как вложенные в вызов toolCallId. */
export async function runChatCodeWork(host: ChatCodeWorkHost, request: CodeWorkRequest): Promise<CodeWorkOutput> {
  let meta = metaOrThrow(host, request.chatId);
  let ownerId = meta.projectContext?.creatorId ?? request.userId;
  let user = host.user(ownerId);
  let emitStep = (step: AgentStep) => host.emit(request.chatId, {type: "toolStep", toolCallId: request.toolCallId, step});
  let work = meta.codeWork;
  let continuing = !!work && codeWorkAlive(work.state) && (!request.projectId || request.projectId === work.projectId);
  if (request.continueOnly && !continuing) {
    throw new Error("Работа с кодом уже завершена. Ответь по сохранённому ходу работы или начни новую работу с кодом.");
  }

  let accountId: number, projectId: string, projectTitle: string, target: CodeWorkTarget | undefined;
  let pinStep: AgentStep | undefined;
  if (continuing) {
    ({accountId, projectId, projectTitle} = work!);
  } else {
    let wanted = (request.projectId ?? "").trim();
    let pinned = chatProjects(meta.projectContext);
    let chosen: ChatProject | undefined = wanted
      ? pinned.find(p => p.projectId === wanted || p.title.toLowerCase() === wanted.toLowerCase())
      : pinned.find(p => p.hasCode) ?? pinned[0];
    if (!chosen) {
      // Агент сам подключает проект, о котором идёт речь: права агента не шире прав человека.
      let choices = await user.listChatProjects();
      let found = wanted ? choices.find(c => c.projectId === wanted || c.title.toLowerCase() === wanted.toLowerCase()) : undefined;
      if (!found) {
        let available = choices.map(c => `«${c.title}» (${c.projectId}${c.hasCode ? ", есть код" : ""})`).join("; ");
        throw new Error(wanted ? `Проект «${wanted}» не найден. Доступные проекты: ${available || "нет"}.` :
          `Укажи projectId. Доступные проекты: ${available || "нет"}.`);
      }
      chosen = {accountId: found.accountId, projectId: found.projectId, title: found.title, pinnedBy: "agent", ...(found.hasCode ? {hasCode: true} : {})};
      let fresh = metaOrThrow(host, request.chatId);
      pinProject(fresh, chosen, ownerId, request.profileId);
      host.putChatMeta(fresh);
      pinStep = {id: `pin:${chosen.projectId}`, kind: "project", status: "done", title: `Подключил проект «${displayName(chosen.title, "без названия")}»`, resource: {kind: "project", name: displayName(chosen.title, "проект")}};
      emitStep(pinStep);
    }
    let found = await user.codeWorkTarget(chosen.accountId, chosen.projectId);
    if (!found?.code) throw new Error(`У проекта «${chosen.title}» нет подключённого кода. Работай с его документами обычными инструментами.`);
    ({accountId, projectId} = chosen);
    projectTitle = chosen.title;
    target = found.code;
  }

  let cursor = continuing ? work!.cursor : 0;
  let {output, cursor: next} = await runCodeWorkTurn({
    backend: backendFor(user, accountId), projectId, projectTitle, target,
    taskId: continuing ? work!.taskId : undefined, cursor, prompt: request.prompt, signal: request.signal,
    onStep: emitStep,
    onText: delta => host.emit(request.chatId, {type: "toolOutputDelta", toolCallId: request.toolCallId, delta}),
    onStarted: taskId => {
      let current = metaOrThrow(host, request.chatId);
      current.codeWork = {accountId, projectId, projectTitle, taskId, state: "running", foreground: false, cursor,
        ...(continuing && current.codeWork?.taskId === taskId ? {summary: current.codeWork.summary, review: current.codeWork.review} : {})};
      host.putChatMeta(current);
    },
  });

  if (pinStep) output.steps.unshift(pinStep);
  let current = metaOrThrow(host, request.chatId);
  let review: ChatCodeWork["review"] = output.changedFiles.length ? {outcome: "draft"} : current.codeWork?.review;
  current.codeWork = {accountId, projectId, projectTitle, taskId: output.taskId, state: output.state,
    foreground: codeWorkAlive(output.state), cursor: next,
    summary: (output.answer || current.codeWork?.summary || "").slice(0, MAX_SUMMARY),
    ...(review ? {review} : {})};
  host.putChatMeta(current);
  return output;
}

export async function readChatCodeChanges(host: ChatCodeWorkHost, chatId: number): Promise<ChatCodeChanges | null> {
  let meta = metaOrThrow(host, chatId);
  let work = meta.codeWork;
  if (!work || !meta.projectContext?.creatorId) return null;
  let changes = await host.user(meta.projectContext.creatorId).codeWorkChanges(work.accountId, work.projectId, work.taskId).catch(() => null);
  if (!changes) return {projectTitle: work.projectTitle, summary: work.summary ?? "", files: [], diff: "", truncated: false, ...(work.review ? {review: work.review} : {})};
  // Группы по репозиториям нужны, только когда их у работы несколько.
  let repositories = (changes.repositories ?? []).length > 1
    ? changes.repositories!.map(r => ({name: displayName(r.name, r.dir || "Репозиторий"), files: r.files, diff: r.diff, truncated: r.truncated}))
    : undefined;
  return {projectTitle: work.projectTitle, summary: work.summary ?? "", files: changes.files, diff: changes.diff, truncated: changes.truncated,
    ...(work.review ? {review: work.review} : {}), ...(repositories ? {repositories} : {})};
}

export async function acceptChatCodeChanges(host: ChatCodeWorkHost, chatId: number, userId: string): Promise<ChatCodeAcceptResult> {
  let meta = metaOrThrow(host, chatId);
  let work = meta.codeWork;
  if (!work) throw new Error("В беседе нет изменений для принятия.");
  if (meta.projectContext?.creatorId !== userId) throw new Error("Принять изменения может тот, кто начал беседу.");
  let summary = work.summary?.trim() || `Изменения агента в проекте «${work.projectTitle}»`;
  let result = await host.user(userId).codeWorkAccept(work.accountId, work.projectId, work.taskId, summary);
  recordReview(host, chatId, work.taskId, result);
  return {outcome: result.outcome, note: result.note};
}

function recordReview(host: ChatCodeWorkHost, chatId: number, taskId: string, result: CodeWorkReview) {
  let current = metaOrThrow(host, chatId);
  if (current.codeWork?.taskId !== taskId) return;
  let mergeRequest = result.mergeRequest ?? current.codeWork.review?.mergeRequest;
  current.codeWork = {...current.codeWork, review: {outcome: result.outcome, note: result.note, ...(mergeRequest ? {mergeRequest} : {})}};
  host.putChatMeta(current);
}

/** «Вернуть как было»: только принятые изменения и только тот, кто их принял (создатель беседы). */
export async function revertChatCodeChanges(host: ChatCodeWorkHost, chatId: number, userId: string): Promise<ChatCodeAcceptResult> {
  let meta = metaOrThrow(host, chatId);
  let work = meta.codeWork;
  if (!work || work.review?.outcome !== "accepted" || !work.review.mergeRequest) throw new Error("Вернуть можно только принятые изменения.");
  if (meta.projectContext?.creatorId !== userId) throw new Error("Вернуть изменения может тот, кто начал беседу.");
  let result = await host.user(userId).codeWorkRevert(work.accountId, work.projectId, work.taskId, work.review.mergeRequest);
  recordReview(host, chatId, work.taskId, result);
  return {outcome: result.outcome, note: result.note};
}
