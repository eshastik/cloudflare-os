// Работа с кодом в беседе: набор проектов, переключатель «Код», выбор, кому отвечать на сообщение
// человека, ход агента кода, «Что изменилось» и «Принять». Хранится в метаданных беседы.
import type {AiChatMessage, AiChatMetadata, AiChatStreamEvent, ChatCodeAcceptResult, ChatCodeChanges, ChatProjectChoice} from "@gadgets/workshop-shared/api";
import {MAX_CHAT_PROJECTS, chatProjects, displayName, validateChatCodeMode, validateChatProjects, type AgentStep, type ChatCodeMode, type ChatCodeWork, type ChatProject, type CodeWorkOutput} from "@gadgets/workshop-shared/code-work";
import type {CodeWorkReview, CodeWorkTarget} from "@gadgets/workshop-shared/gatekeeper";
import {codeWorkAlive, runCodeWorkTurn, type CodeWorkBackend, type CodeWorkFiles} from "./code-work.js";
import {JEV_CONFIDENCE_THRESHOLD, MAX_PROJECT_CANDIDATES, type CodeRouteContext, type JevProjectDecision, type JevResult} from "./code-router.js";
import {
  ATTACHMENT_MAX_BYTES, ATTACHMENTS_DIR, CONTEXT_FILE, CONTEXT_FILE_MAX_BYTES, buildCodeContextPack, bytesToBase64, codeWorkBrief,
  planAttachments, textBytes, withContextFile, withContextPack, type PlannedAttachment,
} from "./code-context.js";

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
  /** Файл в /workspace/.mnemos рабочего места; нет — подключение этого не умеет. */
  codeWorkPutFile?(accountId: number, project: string, task: string, path: string, contentBase64: string): Promise<void>;
  /** Право «Агент кода» человека; нет метода — подключения права не знают. */
  codeWorkAllowed?(): Promise<boolean>;
}

/** Отказ человеку без права «Агент кода». */
export const CODE_AGENT_DISABLED_MESSAGE = "Агент кода выключен: его включает администратор в разделе «Люди и отделы».";

export interface ChatCodeWorkHost {
  chatMeta(chatId: number): AiChatMetadata | undefined;
  putChatMeta(meta: AiChatMetadata): void;
  /** Подключения человека, создавшего беседу (набор проектов принадлежит ему). */
  user(userId: string): CodeWorkUser;
  emit(chatId: number, event: AiChatStreamEvent): void;
  /** Сообщения беседы с номером больше afterSequence, по возрастанию (не больше последних
   *  CONTEXT_PACK_LOOKBACK). */
  chatMessages(chatId: number, afterSequence: number): AiChatMessage[];
  /** Байты файла, приложенного к сообщению беседы; нет — файлы в рабочее место не копируются. */
  attachmentContent?(chatId: number, attachmentId: string): Promise<Uint8Array>;
}

const MAX_SUMMARY = 4000;
const MAX_STORED_FILES = 50;
const MAX_STORED_ATTACHMENT_NAMES = 200;

function backendFor(user: CodeWorkUser, accountId: number): CodeWorkBackend {
  return {
    start: (project, target, prompt) => user.codeWorkStart(accountId, project, target, prompt),
    message: (project, task, text) => user.codeWorkMessage(accountId, project, task, text),
    events: (project, task, after, waitMs) => user.codeWorkEvents(accountId, project, task, after, waitMs),
    abort: (project, task) => user.codeWorkAbort(accountId, project, task),
    interrupt: (project, task) => user.codeWorkInterrupt(accountId, project, task),
    changes: (project, task) => user.codeWorkChanges(accountId, project, task),
    ...(user.codeWorkPutFile ? {putFile: (project: string, task: string, path: string, contentBase64: string) => user.codeWorkPutFile!(accountId, project, task, path, contentBase64)} : {}),
  };
}

/** Скопировать файлы беседы в attachments; статус каждого файла меняется на месте. */
async function copyAttachments(host: ChatCodeWorkHost, chatId: number, backend: CodeWorkBackend, projectId: string, taskId: string,
    files: PlannedAttachment[]): Promise<void> {
  for (let file of files) {
    if (file.status !== "pending") continue;
    if (!host.attachmentContent || !backend.putFile) { file.status = "failed"; continue; }
    try {
      let data = await host.attachmentContent(chatId, file.id);
      if (data.byteLength > ATTACHMENT_MAX_BYTES) { file.status = "too_large"; continue; }
      await backend.putFile(projectId, taskId, ATTACHMENTS_DIR + file.fileName, bytesToBase64(data));
      file.status = "copied";
    } catch {
      file.status = "failed";
    }
  }
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

/** Переключатель «Код» беседы: меняет тот, кто начал беседу (работа с кодом идёт его правами).
 *  codeAllowed=false — у человека нет права «Агент кода»: включить «Код» нельзя, выключить можно. */
export function setChatCodeMode(host: ChatCodeWorkHost, chatId: number, userId: string, value: unknown, codeAllowed = true): void {
  let mode = validateChatCodeMode(value);
  if (!codeAllowed && mode !== "off") throw new Error(CODE_AGENT_DISABLED_MESSAGE);
  let meta = metaOrThrow(host, chatId);
  let creator = meta.projectContext?.creatorId;
  if (creator && creator !== userId) throw new Error("Режим работы с кодом меняет тот, кто начал беседу.");
  meta.codeMode = mode;
  host.putChatMeta(meta);
}

/** Последний ответ дал агент кода, и его работа ещё жива. */
export function codeWorkForeground(meta: AiChatMetadata | undefined): boolean {
  return !!meta?.codeWork?.foreground && codeWorkAlive(meta.codeWork.state);
}

/** Следующий ответ даёт агент беседы: отметка «последний ответ дал агент кода» снимается. */
export function markChatAnswering(host: ChatCodeWorkHost, chatId: number): void {
  let meta = host.chatMeta(chatId);
  if (meta?.codeWork?.foreground) { meta.codeWork = {...meta.codeWork, foreground: false}; host.putChatMeta(meta); }
}

/** Куда агент кода пойдёт с сообщением: продолжит живую работу или начнёт новую в проекте беседы
 *  с кодом. null — в беседе нет проекта с кодом. */
export function chatCodeTarget(meta: AiChatMetadata): {projectId: string; projectTitle: string; continuing: boolean} | null {
  let work = meta.codeWork;
  if (work && codeWorkAlive(work.state)) return {projectId: work.projectId, projectTitle: work.projectTitle, continuing: true};
  let project = chatProjects(meta.projectContext).find(p => p.hasCode);
  return project ? {projectId: project.projectId, projectTitle: project.title, continuing: false} : null;
}

export type ChatRouteReason =
  /** «Код: Выкл». */
  | "off"
  /** «Код: Вкл». */
  | "on"
  /** Агенту кода некуда идти: в беседе нет проекта с кодом. */
  | "no_code_project"
  /** Решение Jev с уверенностью не ниже порога. */
  | "router"
  /** Jev не уверен: отвечает агент беседы, он сам решит, звать ли агента кода. */
  | "router_unsure"
  /** Jev недоступен (нет ключа, ошибка, срок): продолжает тот, кто отвечал последним. */
  | "router_failed"
  /** У человека нет права «Агент кода». */
  | "code_disabled";

export type ChatRoute =
  | {target: "code"; projectId: string; continuing: boolean; reason: ChatRouteReason}
  | {target: "chat"; reason: ChatRouteReason};

export type ChatRouteInput = {
  mode: ChatCodeMode;
  meta: AiChatMetadata;
  message: string;
  /** Последняя реплика агента перед сообщением человека. */
  lastAgentReply?: string;
  /** Вопрос к Jev; нет — маршрутизатор недоступен (например, нет ключа). */
  ask?: (context: CodeRouteContext) => Promise<JevResult>;
  /** Проекты человека: Jev решает, какие из них подключить к беседе и какие убрать. */
  projectChoices?: () => Promise<ChatProjectChoice[]>;
  /** Право «Агент кода» человека; false — в код не маршрутизируется ничего. */
  codeAllowed?: boolean;
};

/** Что Jev поменял в наборе проектов беседы. */
export type ChatProjectChanges = {added: ChatProject[]; removed: ChatProject[]};

/** Убрать проект из беседы Jev может только увереннее, чем подключить: ошибочно убранный проект
 *  лишает агента материалов, ошибочно подключённый — лишь добавляет их. */
export const JEV_REMOVE_CONFIDENCE = 0.8;

type ProjectCandidate = ChatProject & {pinned: boolean};

const projectKey = (p: {accountId: number; projectId: string}) => `${p.accountId}:${p.projectId}`;

/** Подключённые проекты первыми, затем остальные проекты человека. */
function projectCandidates(pinned: ChatProject[], choices: ChatProjectChoice[]): ProjectCandidate[] {
  let byKey = new Map(choices.map(c => [projectKey(c), c]));
  let out: ProjectCandidate[] = pinned.map(p => {
    let choice = byKey.get(projectKey(p));
    return {...p, pinned: true, ...(p.hasCode || choice?.hasCode ? {hasCode: true} : {})};
  });
  let seen = new Set(out.map(projectKey));
  for (let c of choices) {
    if (seen.has(projectKey(c))) continue;
    seen.add(projectKey(c));
    out.push({accountId: c.accountId, projectId: c.projectId, title: c.title, pinnedBy: "agent", pinned: false, ...(c.hasCode ? {hasCode: true} : {})});
  }
  return out.slice(0, MAX_PROJECT_CANDIDATES);
}

/** Правила применения решений Jev. Проект, подключённый человеком, и проект живой работы с кодом
 *  Jev не убирает; больше MAX_CHAT_PROJECTS проектов не подключает. */
export function chatProjectChanges(candidates: ProjectCandidate[], decisions: JevProjectDecision[], meta: AiChatMetadata): ChatProjectChanges {
  let added: ChatProject[] = [], removed: ChatProject[] = [];
  let work = meta.codeWork && codeWorkAlive(meta.codeWork.state) ? meta.codeWork : undefined;
  let count = candidates.filter(c => c.pinned).length;
  for (let d of decisions) {
    let c = candidates[d.index];
    if (!c) continue;
    let {pinned: _pinned, ...project} = c;
    if (d.include && !c.pinned && d.confidence >= JEV_CONFIDENCE_THRESHOLD && count < MAX_CHAT_PROJECTS) {
      added.push({...project, pinnedBy: "agent"});
      count++;
    } else if (!d.include && c.pinned && d.confidence >= JEV_REMOVE_CONFIDENCE && c.pinnedBy !== "user" &&
        !(work && work.projectId === c.projectId)) {
      removed.push(project);
      count--;
    }
  }
  return {added, removed};
}

function withProjectChanges(meta: AiChatMetadata, changes: ChatProjectChanges, userId?: string, profileId?: string): AiChatMetadata {
  let gone = new Set(changes.removed.map(projectKey));
  let projects = [...chatProjects(meta.projectContext).filter(p => !gone.has(projectKey(p))), ...changes.added];
  if (!projects.length) return meta.projectContext ? {...meta, projectContext: {...meta.projectContext, projects: []}} : meta;
  let first = projects[0];
  return {...meta, projectContext: {accountId: first.accountId, projectId: first.projectId, title: first.title, projects,
    // Без userId набор нужен только для выбора маршрута и не записывается.
    creatorId: meta.projectContext?.creatorId ?? userId ?? "", creatorProfileId: meta.projectContext?.creatorProfileId ?? profileId ?? ""}};
}

/** Записать решение Jev о проектах в беседу. */
export function applyChatProjectChanges(host: ChatCodeWorkHost, chatId: number, changes: ChatProjectChanges, userId: string, profileId: string): void {
  if (!changes.added.length && !changes.removed.length) return;
  host.putChatMeta(withProjectChanges(metaOrThrow(host, chatId), changes, userId, profileId));
}

/** Кому отвечать на сообщение человека: агенту кода или агенту беседы. Тем же вопросом Jev
 *  решает, какие проекты человека нужны беседе; маршрут выбирается уже по новому набору. */
export async function routeChatMessage(input: ChatRouteInput): Promise<{route: ChatRoute; jev?: JevResult; projects?: ChatProjectChanges}> {
  let pinned = chatProjects(input.meta.projectContext);
  let choices = input.ask && input.projectChoices ? await input.projectChoices().catch(() => []) : [];
  let candidates = choices.length ? projectCandidates(pinned, choices) : [];
  let work = input.meta.codeWork;
  let alive = !!work && codeWorkAlive(work.state);
  let before = chatCodeTarget(input.meta);
  let jev: JevResult | undefined;
  if (input.ask && (candidates.length || (input.mode === "auto" && before))) {
    jev = await input.ask({
      message: input.message,
      ...(alive ? {work: {projectTitle: work!.projectTitle, topic: codeWorkBrief(work!, 300)}} : {}),
      lastReplyByCode: codeWorkForeground(input.meta),
      ...(input.lastAgentReply ? {lastAgentReply: input.lastAgentReply} : {}),
      codeProjects: pinned.filter(p => p.hasCode).map(p => p.title),
      ...(candidates.length ? {projectCandidates: candidates.map(c => ({title: c.title, pinned: c.pinned, hasCode: !!c.hasCode}))} : {}),
    });
  }
  let projects = jev?.ok && candidates.length ? chatProjectChanges(candidates, jev.decision.projects ?? [], input.meta) : undefined;
  let meta = projects ? withProjectChanges(input.meta, projects) : input.meta;
  let done = (route: ChatRoute) => ({route, ...(jev ? {jev} : {}), ...(projects ? {projects} : {})});

  if (input.codeAllowed === false) return done({target: "chat", reason: "code_disabled"});
  if (input.mode === "off") return done({target: "chat", reason: "off"});
  const target = chatCodeTarget(meta);
  if (!target) return done({target: "chat", reason: "no_code_project"});
  let toCode = (reason: ChatRouteReason): ChatRoute => ({target: "code", projectId: target.projectId, continuing: target.continuing, reason});
  if (input.mode === "on") return done(toCode("on"));

  let answer: JevResult = jev ?? {ok: false, error: "no_key"};
  if (!answer.ok) {
    // Разговор с агентом кода не обрывается из-за сбоя диспетчера; остальное — агенту беседы.
    return {...done(codeWorkForeground(meta) ? toCode("router_failed") : {target: "chat", reason: "router_failed"}), jev: answer};
  }
  if (answer.decision.confidence < JEV_CONFIDENCE_THRESHOLD) return done({target: "chat", reason: "router_unsure"});
  return done(answer.decision.route === "code" ? toCode("router") : {target: "chat", reason: "router"});
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
  /** Номер сообщения человека, текст которого и есть prompt: в пакет контекста не повторяется. */
  promptSequence?: number;
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
  // Окончательно право проверяет служба рабочих мест по Mnemos; здесь отказ до запуска и понятными словами.
  if (user.codeWorkAllowed && !await user.codeWorkAllowed()) throw new Error(CODE_AGENT_DISABLED_MESSAGE);
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

  // Пакет «Контекст беседы»: при продолжении — только новое с прошлого хода, для новой работы —
  // последние сообщения беседы.
  let after = continuing ? work!.contextSeq ?? -1 : -1;
  let seen = host.chatMessages(request.chatId, after);
  let contextSeq = Math.max(after, request.promptSequence ?? -1, ...seen.map(m => m.sequence));
  let messages = seen.filter(m => m.sequence !== request.promptSequence);
  let projects = chatProjects(metaOrThrow(host, request.chatId).projectContext);
  // Файлы берутся и из сообщения, которое стало текстом хода: его текст в пакет не идёт, а файлы — да.
  let usedNames = continuing ? work!.attachmentNames ?? [] : [];
  let usedBytes = continuing ? work!.attachmentBytes ?? 0 : 0;
  let attachments = planAttachments(seen, {names: usedNames, bytes: usedBytes});
  let backend = backendFor(user, accountId);
  let textPack = (pendingAsFailed: boolean) => buildCodeContextPack({messages, projects,
    attachments: pendingAsFailed ? attachments.map(f => f.status === "pending" ? {...f, status: "failed" as const} : f) : attachments});
  let putContext = async (taskId: string) => {
    let pack = buildCodeContextPack({messages, projects, attachments, target: "file", maxBytes: CONTEXT_FILE_MAX_BYTES});
    await backend.putFile!(projectId, taskId, CONTEXT_FILE, bytesToBase64(textBytes(pack)));
  };
  let files: CodeWorkFiles = {
    // Продолжение: файлы до сообщения; не легли — пакет текстом, файлы перечислены по факту.
    beforeMessage: async taskId => {
      if (!backend.putFile) return withContextPack(textPack(true), request.prompt);
      await copyAttachments(host, request.chatId, backend, projectId, taskId, attachments);
      try { await putContext(taskId); } catch { return withContextPack(textPack(true), request.prompt); }
      return withContextFile(request.prompt);
    },
    // Новая работа: пакет уже ушёл текстом при запуске; файл — для перечитывания, вложения — для работы.
    afterStart: async taskId => {
      await copyAttachments(host, request.chatId, backend, projectId, taskId, attachments);
      if (backend.putFile) await putContext(taskId);
    },
  };
  // Для новой работы вложения ещё не скопированы: пакет говорит, что они копируются.
  let prompt = continuing ? withContextPack(textPack(true), request.prompt)
    : withContextPack(textPack(!backend.putFile || !host.attachmentContent), request.prompt);

  let cursor = continuing ? work!.cursor : 0;
  let {output, cursor: next} = await runCodeWorkTurn({
    backend, projectId, projectTitle, target, files,
    taskId: continuing ? work!.taskId : undefined, cursor, prompt, signal: request.signal,
    onStep: emitStep,
    onText: delta => host.emit(request.chatId, {type: "toolOutputDelta", toolCallId: request.toolCallId, delta}),
    onStarted: taskId => {
      let current = metaOrThrow(host, request.chatId);
      let same = continuing && current.codeWork?.taskId === taskId;
      current.codeWork = {accountId, projectId, projectTitle, taskId, state: "running", foreground: false, cursor, contextSeq,
        ...(same ? {summary: current.codeWork!.summary, review: current.codeWork!.review, changedFiles: current.codeWork!.changedFiles,
          attachmentNames: current.codeWork!.attachmentNames, attachmentBytes: current.codeWork!.attachmentBytes} : {})};
      host.putChatMeta(current);
    },
  });

  if (pinStep) output.steps.unshift(pinStep);
  let copied = attachments.filter(f => f.status === "copied");
  // Задача могла смениться (прежняя закончилась): тогда прежние имена к ней не относятся.
  let sameTask = continuing && work!.taskId === output.taskId;
  let attachmentNames = [...(sameTask ? usedNames : []), ...copied.map(f => f.fileName)].slice(-MAX_STORED_ATTACHMENT_NAMES);
  let attachmentBytes = (sameTask ? usedBytes : 0) + copied.reduce((sum, f) => sum + f.size, 0);
  let current = metaOrThrow(host, request.chatId);
  let review: ChatCodeWork["review"] = output.changedFiles.length ? {outcome: "draft"} : current.codeWork?.review;
  current.codeWork = {accountId, projectId, projectTitle, taskId: output.taskId, state: output.state,
    foreground: codeWorkAlive(output.state), cursor: next,
    summary: (output.answer || current.codeWork?.summary || "").slice(0, MAX_SUMMARY),
    contextSeq,
    ...(attachmentNames.length ? {attachmentNames, attachmentBytes} : {}),
    changedFiles: output.changedFiles.slice(0, MAX_STORED_FILES).map(f => ({path: f.path, status: f.status})),
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
