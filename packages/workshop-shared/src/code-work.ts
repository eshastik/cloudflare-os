// Работа с кодом внутри беседы: набор проектов беседы, шаги агента кода и итог его хода.
// Агент беседы один; когда задача про код, он переходит в рабочее место (OpenCode) через
// инструмент codeWork, а шаги рабочего места показываются в ленте как вложенные строки.

/** Проект в наборе беседы. Контекст работы, а не право доступа. */
export type ChatProject = {
  accountId: number;
  projectId: string;
  title: string;
  /** Кто подключил проект к беседе: человек чипом или агент по ходу работы. */
  pinnedBy: "user" | "agent";
  /** У проекта есть подключённый код (известно на момент подключения). */
  hasCode?: boolean;
};

/** Состояние работы с кодом в беседе; хранится в метаданных беседы. */
export type ChatCodeWork = {
  accountId: number;
  projectId: string;
  projectTitle: string;
  taskId: string;
  /** Состояние задачи в рабочем месте на последнем опросе. */
  state: "starting" | "running" | "idle" | "stopped" | "failed";
  /** Последний ответ в беседе дал агент кода. Нужен маршрутизатору, когда нейросеть-диспетчер
   *  недоступна: тогда продолжение разговора с агентом кода остаётся у него. */
  foreground: boolean;
  /** Последнее прочитанное событие рабочего места: следующий ход читает только новые. */
  cursor: number;
  /** Итог последнего хода агента кода (для «Что изменилось» и описания при «Принять»). */
  summary?: string;
  /** Контекст беседы передан агенту кода до этого номера сообщения включительно. */
  contextSeq?: number;
  /** Изменённые и ещё не принятые файлы на конец последнего хода (для сводки агенту беседы). */
  changedFiles?: {path: string; status: ChangedFile["status"]}[];
  /** Решение по результату: ещё не принят, ждёт согласования, принят. */
  review?: {outcome: "draft" | "awaiting_approval" | "accepted" | "rejected" | "no_approver" | "reverted"; note?: string; responsible?: string[];
    /** Номер запроса на слияние в Mnemos: нужен для «Вернуть как было». Человеку не показывается. */
    mergeRequest?: number};
};

export type AgentStepKind =
  "file" | "edit" | "run" | "search" | "memory" | "document" | "database" | "code" | "project" | "web" | "tool" | "state";

/** Один шаг агента в ленте: человеческая строка и подробности по раскрытию. */
export type AgentStep = {
  id: string;
  kind: AgentStepKind;
  /** Строка для человека: «Прочитал файл README.md». Без технических слов. */
  title: string;
  status: "running" | "done" | "error";
  /** Подробности по раскрытию: команда, запрос, путь (здесь технические слова допустимы). */
  detail?: string;
  /** Вывод инструмента, обрезанный. */
  output?: string;
  /** Ресурс, к которому обращался шаг (для сводки «обращался к …»). */
  resource?: {kind: "file" | "document" | "database" | "search" | "command" | "web" | "project"; name: string};
  additions?: number;
  deletions?: number;
};

export type ChangedFile = {path: string; status: "added" | "modified" | "deleted" | "renamed"; additions: number; deletions: number};

/** «Что изменилось» в одном репозитории проекта; name — имя репозитория для человека, пути — внутри него. */
export type CodeChangesRepository = {name: string; files: ChangedFile[]; diff: string; truncated: boolean};

/** Итог одного хода работы с кодом: то, что видит агент беседы и человек. */
export type CodeWorkOutput = {
  taskId: string;
  projectId: string;
  projectTitle: string;
  state: ChatCodeWork["state"];
  steps: AgentStep[];
  answer: string;
  changedFiles: ChangedFile[];
  durationMs: number;
  /** Человек остановил ответ агента кода; работа с кодом осталась живой. */
  interrupted?: boolean;
};

export const MAX_CHAT_PROJECTS = 8;

/** Переключатель «Код» у поля ввода.
 *  off — всё отвечает агент беседы, инструментов кода у него нет;
 *  on — каждое сообщение человека идёт агенту кода (OpenCode);
 *  auto — куда идёт сообщение, решает маршрутизатор по смыслу. */
export type ChatCodeMode = "off" | "auto" | "on";

export const CHAT_CODE_MODES: readonly ChatCodeMode[] = ["off", "auto", "on"];

/** Режим беседы; если не задан — «Авто». */
export function chatCodeMode(meta: {codeMode?: ChatCodeMode} | undefined): ChatCodeMode {
  let mode = meta?.codeMode;
  return mode && CHAT_CODE_MODES.includes(mode) ? mode : "auto";
}

export function validateChatCodeMode(value: unknown): ChatCodeMode {
  if (typeof value !== "string" || !CHAT_CODE_MODES.includes(value as ChatCodeMode)) throw new Error("Неверный режим работы с кодом");
  return value as ChatCodeMode;
}

/** Похоже на внутренний идентификатор (hex, UUID, «prefix-<hex>»), а не на название для человека. */
export function looksLikeId(value: string | null | undefined): boolean {
  let v = (value ?? "").trim();
  if (!v || /\s/.test(v)) return false;
  if (/^[0-9a-f]{12,}$/i.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  return /[0-9a-f]{16,}/i.test(v) || /^[a-z]+[_-][0-9a-z]{20,}$/i.test(v) && /\d/.test(v);
}

/** Название для ленты и шапки: пустое или похожее на идентификатор заменяется подписью. */
export function displayName(name: string | null | undefined, fallback: string): string {
  let v = (name ?? "").trim();
  return v && !looksLikeId(v) ? v : fallback;
}

/** Набор проектов беседы; старое одиночное поле читается как проект, выбранный человеком. */
export function chatProjects(context: {accountId?: number; projectId?: string; title?: string; projects?: ChatProject[]} | undefined): ChatProject[] {
  if (!context) return [];
  if (Array.isArray(context.projects)) return context.projects;
  if (typeof context.projectId === "string" && context.projectId && typeof context.accountId === "number") {
    return [{accountId: context.accountId, projectId: context.projectId, title: displayName(context.title, "Проект"), pinnedBy: "user"}];
  }
  return [];
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}

/** Проверка набора проектов от клиента; бросает понятную ошибку. */
export function validateChatProjects(value: unknown): ChatProject[] {
  if (!Array.isArray(value) || value.length > MAX_CHAT_PROJECTS) throw new Error("Неверный набор проектов беседы");
  let seen = new Set<string>();
  return value.map(item => {
    let p = item as ChatProject;
    if (!p || !Number.isSafeInteger(p.accountId) || p.accountId < 0 || !validText(p.projectId, 256) || !validText(p.title, 256) ||
        (p.pinnedBy !== "user" && p.pinnedBy !== "agent")) throw new Error("Неверный проект беседы");
    let key = `${p.accountId}:${p.projectId}`;
    if (seen.has(key)) throw new Error("Проект указан дважды");
    seen.add(key);
    return {accountId: p.accountId, projectId: p.projectId, title: p.title.trim(), pinnedBy: p.pinnedBy, ...(p.hasCode ? {hasCode: true} : {})};
  });
}

const MAX_SUMMARY_STEPS = 40;

/** Текст итога для агента беседы (и для переигрывания истории): ответ, шаги, изменённые файлы. */
export function formatCodeWorkResult(output: CodeWorkOutput): string {
  let lines = [
    // Идентификатор задачи агенту беседы не нужен (продолжение идёт по беседе) и не должен
    // попадать в его ответ человеку; projectId нужен для следующих вызовов инструментов.
    `Работа с кодом проекта «${output.projectTitle}» (projectId для инструментов: ${output.projectId}), состояние: ${output.state}.`,
  ];
  if (output.interrupted) {
    lines.push("", "Человек остановил ответ агента кода. Работа с кодом не закрыта и продолжится по следующему сообщению человека. Сам работу не продолжай: коротко скажи, на чём остановились.");
  }
  if (output.answer.trim()) lines.push("", "Ответ агента кода:", output.answer.trim());
  let steps = output.steps.filter(s => s.kind !== "state");
  if (steps.length) {
    lines.push("", `Шаги (${steps.length}):`);
    for (let s of steps.slice(-MAX_SUMMARY_STEPS)) lines.push(`- ${s.title}${s.status === "error" ? " — ошибка" : ""}`);
  }
  if (output.changedFiles.length) {
    lines.push("", "Изменённые файлы (ещё не приняты человеком):");
    for (let f of output.changedFiles) lines.push(`- ${f.path} (${f.status}, +${f.additions} −${f.deletions})`);
    lines.push("", "Человек видит карточку «Что изменилось» с кнопкой «Принять». Не обещай, что изменения уже сохранены.");
  } else {
    lines.push("", "Изменений в файлах нет.");
  }
  return lines.join("\n");
}

/** Сводка для строки над ответом: «обращался к: 5 файлов, 2 документа». */
export function stepResources(steps: AgentStep[]): {kind: NonNullable<AgentStep["resource"]>["kind"]; names: string[]}[] {
  let by = new Map<NonNullable<AgentStep["resource"]>["kind"], Set<string>>();
  for (let s of steps) {
    if (!s.resource) continue;
    let set = by.get(s.resource.kind) ?? new Set<string>();
    set.add(s.resource.name);
    by.set(s.resource.kind, set);
  }
  return [...by].map(([kind, names]) => ({kind, names: [...names]}));
}
