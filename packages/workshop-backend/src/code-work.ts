// Один ход работы с кодом: запустить или продолжить сессию в рабочем месте, показывать шаги по
// мере прихода событий и вернуть итог агенту беседы. Долговечная запись хода — вызов codeWork в
// ленте беседы, поэтому история не зависит от контейнера.
import type {AgentStep, ChangedFile, CodeChangesRepository, CodeWorkOutput} from "@gadgets/workshop-shared/code-work";
import type {CodeWorkState, CodeWorkTarget} from "@gadgets/workshop-shared/gatekeeper";
import {CodeWorkTimeline, type CodeWorkEvent} from "./code-work-timeline.js";

/** Доступ к рабочему месту через подключённую память человека (Mnemos). */
export interface CodeWorkBackend {
  start(project: string, target: CodeWorkTarget, prompt: string): Promise<{taskId: string; state: CodeWorkState; scopeExtended: boolean}>;
  message(project: string, taskId: string, text: string): Promise<void>;
  events(project: string, taskId: string, after: number, waitMs: number): Promise<{events: CodeWorkEvent[]; next: number; state: CodeWorkState}>;
  abort(project: string, taskId: string): Promise<void>;
  /** Остановить текущий ответ агента кода, не закрывая работу с кодом. */
  interrupt(project: string, taskId: string): Promise<void>;
  /** Изменения с последнего «Принять»; repositories — по репозиториям, когда их несколько. */
  changes(project: string, taskId: string): Promise<{files: ChangedFile[]; diff: string; truncated: boolean;
    repositories?: (CodeChangesRepository & {dir?: string})[]}>;
  /** Положить файл в /workspace/.mnemos задачи; нет — подключение этого не умеет. */
  putFile?(project: string, taskId: string, path: string, contentBase64: string): Promise<void>;
}

/** Файлы контекста в рабочем месте на этом ходе. */
export type CodeWorkFiles = {
  /** Продолжение: положить файлы до сообщения и вернуть текст хода. Ошибка — уходит prompt хода. */
  beforeMessage(taskId: string): Promise<string>;
  /** Новая работа: задача уже передана при запуске; файлы кладутся, как только рабочее место
   *  становится running или idle (раньше служба их не примет). */
  afterStart(taskId: string): Promise<void>;
};

export type CodeWorkTurn = {
  backend: CodeWorkBackend;
  projectId: string;
  projectTitle: string;
  /** Нужен для запуска новой сессии; при продолжении не используется. */
  target?: CodeWorkTarget;
  /** Сессия продолжается, если задача ещё жива. */
  taskId?: string;
  cursor: number;
  prompt: string;
  /** Контекст файлами; нет — prompt уходит как есть. */
  files?: CodeWorkFiles;
  signal: AbortSignal;
  onStep(step: AgentStep): void;
  onText?(delta: string): void;
  onStarted?(taskId: string): void;
  clock?: () => number;
  waitMs?: number;
  maxDurationMs?: number;
  /** Сколько опросов подряд без работы считать «агент кода ничего не делает». */
  idleWithoutWorkPolls?: number;
};

const LIVE: readonly CodeWorkState[] = ["starting", "running", "idle"];
export function codeWorkAlive(state: CodeWorkState | undefined): boolean { return !!state && LIVE.includes(state); }

export async function runCodeWorkTurn(turn: CodeWorkTurn): Promise<{output: CodeWorkOutput; cursor: number}> {
  let clock = turn.clock ?? Date.now;
  let waitMs = turn.waitMs ?? 15_000;
  let maxDuration = turn.maxDurationMs ?? 45 * 60_000;
  let quietLimit = turn.idleWithoutWorkPolls ?? 4;
  let startedAt = clock();
  let timeline = new CodeWorkTimeline(turn.cursor);
  let taskId = turn.taskId;
  let state: CodeWorkState = "starting";
  let extra: AgentStep[] = [];
  turn.signal.throwIfAborted();

  // Файлы новой работы кладутся в фоне, чтобы не задерживать показ шагов; ход ждёт их в конце.
  let placing: Promise<void> | undefined;
  let place = (id: string, now: CodeWorkState) => {
    if (placing || !turn.files || (now !== "running" && now !== "idle")) return;
    placing = turn.files.afterStart(id).catch(() => { /* пакет уже ушёл текстом при запуске */ });
  };

  if (taskId) {
    let text = turn.prompt;
    if (turn.files) {
      try { text = await turn.files.beforeMessage(taskId); } catch { /* запасной путь: пакет текстом */ }
    }
    await turn.backend.message(turn.projectId, taskId, text);
  } else {
    if (!turn.target) throw new Error("У проекта нет подключённого кода.");
    let started = await turn.backend.start(turn.projectId, turn.target, turn.prompt);
    taskId = started.taskId;
    state = started.state;
    place(taskId, state);
    if (started.scopeExtended) {
      extra.push({id: "project-scope", kind: "project", status: "done", title: `Подключил проект «${turn.projectTitle}»`,
        detail: "Проект добавлен в область агента; права агента не шире ваших.", resource: {kind: "project", name: turn.projectTitle}});
      turn.onStep(extra[extra.length - 1]);
    }
  }
  turn.onStarted?.(taskId);

  // «Остановить» не ждёт конца долгого опроса событий.
  let abortedSignal = new Promise<"aborted">(resolve => {
    if (turn.signal.aborted) resolve("aborted");
    else turn.signal.addEventListener("abort", () => resolve("aborted"), {once: true});
  });
  let apply = (events: CodeWorkEvent[]) => {
    let {steps, textDelta} = timeline.apply(events);
    for (let step of steps) turn.onStep(step);
    if (textDelta) turn.onText?.(textDelta);
  };
  let sawBusy = false, quietPolls = 0, stopped = false, interrupted = false;
  let tail: AgentStep[] = [];
  for (;;) {
    if (turn.signal.aborted) {
      // Остановка прерывает только текущий ответ: рабочая копия с непринятыми изменениями остаётся.
      // Если прервать ход нельзя (рабочее место ещё готовится или служба отказала) — работа закрывается.
      try {
        await turn.backend.interrupt(turn.projectId, taskId);
        state = "idle"; interrupted = true;
        let step: AgentStep = {id: "interrupted", kind: "state", status: "done", title: "Остановлено по вашей просьбе"};
        try { apply((await turn.backend.events(turn.projectId, taskId, timeline.cursor, 0)).events); } catch { /* хвост событий прочитает следующий ход */ }
        tail.push(step);
        turn.onStep(step);
      } catch {
        await turn.backend.abort(turn.projectId, taskId).catch(() => {});
        state = "stopped"; stopped = true;
      }
      break;
    }
    if (clock() - startedAt > maxDuration) break;
    let poll = turn.backend.events(turn.projectId, taskId, timeline.cursor, waitMs);
    poll.catch(() => {});
    let batch = await Promise.race([poll, abortedSignal]);
    if (batch === "aborted") continue;
    apply(batch.events);
    state = batch.state;
    if (!turn.taskId) place(taskId, state);
    if (state === "starting" || state === "running" || timeline.sawWork()) sawBusy = true;
    if (state === "stopped" || state === "failed") break;
    if (state === "idle") {
      if (sawBusy) break;
      // Рабочее место может успеть стать «свободным» до того, как примет сообщение.
      if (++quietPolls >= quietLimit) break;
    }
  }

  await placing;
  let changedFiles: ChangedFile[] = [];
  if (!stopped && state !== "failed") {
    try { changedFiles = (await turn.backend.changes(turn.projectId, taskId)).files; } catch { /* список изменений не обязателен для итога */ }
  }
  return {
    cursor: timeline.cursor,
    output: {taskId, projectId: turn.projectId, projectTitle: turn.projectTitle, state, steps: [...extra, ...timeline.steps(), ...tail],
      answer: timeline.answer(), changedFiles, durationMs: Math.max(0, clock() - startedAt), ...(interrupted ? {interrupted} : {})},
  };
}
