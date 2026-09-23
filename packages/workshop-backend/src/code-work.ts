// Один ход работы с кодом: запустить или продолжить сессию в рабочем месте, показывать шаги по
// мере прихода событий и вернуть итог агенту беседы. Долговечная запись хода — вызов codeWork в
// ленте беседы, поэтому история не зависит от контейнера.
import type {AgentStep, ChangedFile, CodeWorkOutput} from "@gadgets/workshop-shared/code-work";
import type {CodeWorkState, CodeWorkTarget} from "@gadgets/workshop-shared/gatekeeper";
import {CodeWorkTimeline, type CodeWorkEvent} from "./code-work-timeline.js";

/** Доступ к рабочему месту через подключённую память человека (Mnemos). */
export interface CodeWorkBackend {
  start(project: string, target: CodeWorkTarget, prompt: string): Promise<{taskId: string; state: CodeWorkState; scopeExtended: boolean}>;
  message(project: string, taskId: string, text: string): Promise<void>;
  events(project: string, taskId: string, after: number, waitMs: number): Promise<{events: CodeWorkEvent[]; next: number; state: CodeWorkState}>;
  abort(project: string, taskId: string): Promise<void>;
  changes(project: string, taskId: string): Promise<{files: ChangedFile[]; diff: string; truncated: boolean}>;
}

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

  if (taskId) {
    await turn.backend.message(turn.projectId, taskId, turn.prompt);
  } else {
    if (!turn.target) throw new Error("У проекта нет подключённого кода.");
    let started = await turn.backend.start(turn.projectId, turn.target, turn.prompt);
    taskId = started.taskId;
    state = started.state;
    if (started.scopeExtended) {
      extra.push({id: "project-scope", kind: "project", status: "done", title: `Подключил проект «${turn.projectTitle}»`,
        detail: "Проект добавлен в область агента; права агента не шире ваших.", resource: {kind: "project", name: turn.projectTitle}});
      turn.onStep(extra[extra.length - 1]);
    }
  }
  turn.onStarted?.(taskId);

  let sawBusy = false, quietPolls = 0, stopped = false;
  for (;;) {
    if (turn.signal.aborted) {
      await turn.backend.abort(turn.projectId, taskId).catch(() => {});
      state = "stopped"; stopped = true;
      break;
    }
    if (clock() - startedAt > maxDuration) break;
    let batch = await turn.backend.events(turn.projectId, taskId, timeline.cursor, waitMs);
    let {steps, textDelta} = timeline.apply(batch.events);
    for (let step of steps) turn.onStep(step);
    if (textDelta) turn.onText?.(textDelta);
    state = batch.state;
    if (state === "starting" || state === "running" || timeline.sawWork()) sawBusy = true;
    if (state === "stopped" || state === "failed") break;
    if (state === "idle") {
      if (sawBusy) break;
      // Рабочее место может успеть стать «свободным» до того, как примет сообщение.
      if (++quietPolls >= quietLimit) break;
    }
  }

  let changedFiles: ChangedFile[] = [];
  if (!stopped && state !== "failed") {
    try { changedFiles = (await turn.backend.changes(turn.projectId, taskId)).files; } catch { /* список изменений не обязателен для итога */ }
  }
  return {
    cursor: timeline.cursor,
    output: {taskId, projectId: turn.projectId, projectTitle: turn.projectTitle, state, steps: [...extra, ...timeline.steps()],
      answer: timeline.answer(), changedFiles, durationMs: Math.max(0, clock() - startedAt)},
  };
}
