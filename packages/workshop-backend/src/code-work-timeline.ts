// Разбор событий рабочего места (OpenCode) в шаги для ленты беседы. Строка шага — для
// нетехнического человека («Прочитал файл», «Выполнил команду»); команды, пути и выводы —
// только в подробностях по раскрытию.
import {displayName, type AgentStep} from "@gadgets/workshop-shared/code-work";

export type CodeWorkEvent = {seq: number; type: string; data: unknown};

const MAX_OUTPUT = 4000;
const MAX_TITLE = 140;
const MAX_STEPS = 300;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function oneLine(value: string, max = MAX_TITLE): string {
  let line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}
function clip(value: string): string {
  return value.length > MAX_OUTPUT ? value.slice(0, MAX_OUTPUT) + "\n…" : value;
}
/** Путь внутри рабочей копии без каталога контейнера. */
export function relativePath(path: string): string {
  return path.replace(/^\/workspace\/repo\/?/, "") || path;
}
function lineCount(value: unknown): number {
  let s = text(value);
  return s ? s.split("\n").length : 0;
}

const MAX_COMMAND = 80;

/** Первая непустая строка команды, не длиннее MAX_COMMAND; многострочная помечается «…». */
export function shortCommand(command: string): string {
  let lines = command.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  let first = lines[0].replace(/\s+/g, " ");
  if (first.length > MAX_COMMAND) return first.slice(0, MAX_COMMAND - 1) + "…";
  return lines.length > 1 ? `${first} …` : first;
}

type Verb = {running: string; done: string; error: string};
function verb(running: string, done: string, subject = ""): Verb {
  let tail = subject ? ` ${subject}` : "";
  return {running: `${running}${tail}`, done: `${done}${tail}`, error: `Не удалось: ${done.toLowerCase()}${tail}`};
}

/** Инструмент памяти Mnemos подключён к рабочему месту как MCP-сервер «mnemos». */
function mnemosTool(tool: string): string | null {
  let m = /^(?:mnemos_)?(mnemos_[a-z_]+)$/.exec(tool);
  return m ? m[1] : null;
}

function describeTool(tool: string, input: Record<string, unknown>): {kind: AgentStep["kind"]; verb: Verb; detail?: string; resource?: AgentStep["resource"]} | null {
  let file = relativePath(text(input.filePath) || text(input.path) || text(input.file));
  let name = oneLine(file || "файл", 80);
  switch (tool) {
    case "read":
      return {kind: "file", verb: verb("Читаю файл", "Прочитал файл", name), detail: file, resource: file ? {kind: "file", name: file} : undefined};
    case "edit": case "write": case "patch": case "multiedit":
      return {kind: "edit", verb: verb(tool === "write" ? "Записываю файл" : "Меняю файл", tool === "write" ? "Записал файл" : "Изменил файл", name), detail: file, resource: file ? {kind: "file", name: file} : undefined};
    case "bash": {
      let command = text(input.command);
      let description = text(input.description);
      if (/\bgit\s+push\b/.test(command)) return {kind: "run", verb: verb("Сохраняю работу", "Сохранил работу"), detail: command};
      // В заголовке — сама команда (коротко), иначе человек не видит, что именно запускалось.
      // Пояснение агента и полный текст команды — в подробностях.
      let short = shortCommand(command);
      let what = short ? ` ${short}` : description ? `: ${oneLine(description, 90)}` : "";
      let detail = description && short ? `# ${oneLine(description, 200)}\n${command}` : command;
      return {kind: "run", verb: {running: `Выполняю команду${what}`, done: `Выполнил команду${what}`, error: `Команда завершилась с ошибкой${what}`}, detail, resource: {kind: "command", name: oneLine(command, 80) || "команда"}};
    }
    case "grep": case "glob": {
      let pattern = oneLine(text(input.pattern) || text(input.query), 80);
      return {kind: "search", verb: verb("Ищу в файлах", "Поискал в файлах", pattern ? `«${pattern}»` : ""), detail: pattern};
    }
    case "list":
      return {kind: "file", verb: verb("Смотрю папку", "Посмотрел папку", name === "файл" ? "" : name), detail: file};
    case "webfetch": {
      let url = text(input.url);
      let host = url; try { host = new URL(url).host; } catch { /* оставить как есть */ }
      return {kind: "web", verb: verb("Открываю страницу", "Открыл страницу", host), detail: url, resource: url ? {kind: "web", name: host} : undefined};
    }
    case "todowrite": case "todoread": case "task":
      return null;
  }
  let mnemos = mnemosTool(tool);
  if (mnemos) {
    let query = oneLine(text(input.query) || text(input.q) || text(input.sql) || text(input.question), 90);
    switch (mnemos) {
      case "mnemos_search":
        return {kind: "memory", verb: verb("Ищу в памяти", "Поискал в памяти", query ? `«${query}»` : ""), detail: query, resource: {kind: "search", name: query || "поиск"}};
      case "mnemos_read": {
        // Идентификатор узла человеку ничего не говорит: в строке — путь или слово «документ».
        let raw = text(input.path) || text(input.node_id) || text(input.node);
        let doc = oneLine(displayName(raw, ""), 80);
        return {kind: "document", verb: verb("Открываю документ", "Открыл документ", doc), detail: raw || undefined, resource: {kind: "document", name: doc || raw || "документ"}};
      }
      case "mnemos_query": {
        let raw = text(input.database) || text(input.db_id);
        let db = displayName(raw, "");
        return {kind: "database", verb: verb("Запрашиваю базу", "Запросил базу", db), detail: text(input.sql) || query, resource: {kind: "database", name: db || raw || "база"}};
      }
      case "mnemos_overview":
        return {kind: "project", verb: verb("Смотрю обзор проекта", "Посмотрел обзор проекта"), detail: text(input.project_id)};
      default:
        if (mnemos.startsWith("mnemos_git_")) return {kind: "code", verb: verb("Смотрю код проекта", "Посмотрел код проекта"), detail: `${mnemos} ${JSON.stringify(input)}`.slice(0, 400)};
        return {kind: "tool", verb: verb("Обращаюсь к памяти", "Обратился к памяти"), detail: mnemos};
    }
  }
  return {kind: "tool", verb: verb("Использую инструмент", "Использовал инструмент", `«${oneLine(tool || "без названия", 60)}»`), detail: tool};
}

/** Разбор одного хода: шаги по мере прихода, ответ агента кода, без повторов по seq. */
export class CodeWorkTimeline {
  #after: number;
  #steps = new Map<string, AgentStep>();
  #roles = new Map<string, string>();
  #texts = new Map<string, {message: string; value: string}>();
  #sent = new Map<string, number>();
  #lastAssistant = "";
  #state = "";

  /** after — курсор предыдущего хода: события не новее него уже показаны. */
  constructor(after: number) { this.#after = after; }

  get cursor(): number { return this.#after; }
  get state(): string { return this.#state; }

  /** Применяет события; возвращает изменившиеся шаги и приращение текста ответа. */
  apply(events: CodeWorkEvent[]): {steps: AgentStep[]; textDelta: string} {
    let changed = new Map<string, AgentStep>();
    let delta = "";
    for (let event of [...events].sort((a, b) => a.seq - b.seq)) {
      if (!Number.isSafeInteger(event.seq) || event.seq <= this.#after) continue;
      this.#after = event.seq;
      let data = record(event.data);
      if (event.type === "workspace.state") {
        let state = text(data.state);
        if (state) this.#state = state;
        if (state === "failed" || state === "stopped") {
          let reason = oneLine(text(data.reason), 120);
          let step: AgentStep = {id: `state:${event.seq}`, kind: "state", status: state === "failed" ? "error" : "done",
            title: state === "failed" ? `Работа с кодом прервалась${reason ? `: ${reason}` : ""}` : "Работа с кодом остановлена"};
          this.#put(step, changed);
        }
        continue;
      }
      if (event.type === "message.updated") {
        let info = record(data.info);
        let id = text(info.id), role = text(info.role);
        if (id && role) this.#roles.set(id, role);
        if (role === "assistant" && id) this.#lastAssistant = id;
        continue;
      }
      if (event.type !== "message.part.updated") continue;
      let part = record(data.part);
      let type = text(part.type);
      if (type === "tool") {
        let step = this.#tool(part);
        if (step) this.#put(step, changed);
      } else if (type === "text" && text(part.id)) {
        let message = text(part.messageID);
        let value = text(part.text);
        this.#texts.set(text(part.id), {message, value});
        if (this.#roles.get(message) === "assistant") {
          let sent = this.#sent.get(text(part.id)) ?? 0;
          if (value.length > sent) { delta += value.slice(sent); this.#sent.set(text(part.id), value.length); }
        }
      }
    }
    return {steps: [...changed.values()], textDelta: delta};
  }

  #put(step: AgentStep, changed: Map<string, AgentStep>) {
    if (!this.#steps.has(step.id) && this.#steps.size >= MAX_STEPS) return;
    this.#steps.set(step.id, step);
    changed.set(step.id, step);
  }

  #tool(part: Record<string, unknown>): AgentStep | null {
    let state = record(part.state);
    let status = text(state.status);
    if (status !== "running" && status !== "completed" && status !== "error" && status !== "pending") return null;
    let input = record(state.input);
    let tool = text(part.tool);
    let id = text(part.callID) || text(part.id);
    if (!id) return null;
    let described = describeTool(tool, input);
    if (!described) return null;
    let s: AgentStep["status"] = status === "completed" ? "done" : status === "error" ? "error" : "running";
    let step: AgentStep = {id, kind: described.kind, status: s, title: described.verb[s === "done" ? "done" : s === "error" ? "error" : "running"]};
    if (described.detail) step.detail = described.detail;
    if (described.resource) step.resource = described.resource;
    let output = s === "error" ? text(state.error) : text(state.output);
    if (output) step.output = clip(output);
    if (described.kind === "edit") {
      let removed = lineCount(input.oldString), added = lineCount(input.newString) || (tool === "write" ? lineCount(input.content) : 0);
      if (added || removed) { step.additions = added; step.deletions = removed; step.title += ` +${added} −${removed}`; }
    }
    return step;
  }

  steps(): AgentStep[] { return [...this.#steps.values()]; }

  /** Итоговый текст агента кода за этот ход (последнее его сообщение). */
  answer(): string {
    let assistant = [...this.#texts.values()].filter(t => this.#roles.get(t.message) === "assistant" && t.value.trim());
    let last = assistant.filter(t => t.message === this.#lastAssistant);
    return (last.length ? last : assistant.slice(-1)).map(t => t.value.trim()).join("\n\n");
  }

  /** Взялся ли агент кода за работу в этом ходе: сообщение человека работой не считается. */
  sawWork(): boolean { return this.#steps.size > 0 || [...this.#roles.values()].includes("assistant"); }
}
