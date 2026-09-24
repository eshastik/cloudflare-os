/** Событие службы рабочих мест: тип OpenCode или workspace.state, данные — properties события. */
export interface WorkspaceEvent { seq: number; type: string; data: unknown }
export type WorkspaceStepKind = "clone" | "read" | "edit" | "run" | "search" | "push" | "tool" | "state";
export type WorkspaceStepStatus = "running" | "done" | "error";
export interface WorkspaceStep { id: string; kind: WorkspaceStepKind; text: string; status: WorkspaceStepStatus }
export interface WorkspaceProgress { steps: WorkspaceStep[]; answer: string }

const MAX_STEPS = 200;
const MAX_TEXT = 160;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function short(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > MAX_TEXT ? line.slice(0, MAX_TEXT - 1) + "…" : line;
}
/** Путь без каталога контейнера. Прежние задачи клонировали в /workspace/repo — эта папка
 * убирается; у задач с именованными папками репозиториев имя папки остаётся в пути. */
function relative(path: string): string {
  return path.replace(/^\/workspace\/(?:repo(?:\/|$))?/, "") || path;
}

function toolStep(part: Record<string, unknown>): WorkspaceStep | null {
  const state = record(part.state);
  const status = text(state.status);
  if (status !== "running" && status !== "completed" && status !== "error") return null;
  const input = record(state.input);
  const tool = text(part.tool);
  const id = text(part.id) || text(part.callID);
  const done: WorkspaceStepStatus = status === "completed" ? "done" : status === "error" ? "error" : "running";
  const file = relative(text(input.filePath) || text(input.path));
  switch (tool) {
    case "bash": {
      const command = text(input.command);
      if (/\bgit\s+push\b/.test(command)) return { id, kind: "push", status: done, text: done === "done" ? "Отправил изменения в свою ветку" : done === "error" ? "Не удалось отправить изменения" : "Отправляю изменения в свою ветку" };
      return { id, kind: "run", status: done, text: `Выполняю: ${short(command || text(input.description) || "команду")}` };
    }
    case "read": return { id, kind: "read", status: done, text: `Читаю ${short(file || "файл")}` };
    case "edit": case "write": case "patch": case "multiedit": return { id, kind: "edit", status: done, text: `Правлю ${short(file || "файл")}` };
    case "grep": case "glob": return { id, kind: "search", status: done, text: `Ищу ${short(text(input.pattern) || "в коде")}` };
    case "list": return { id, kind: "search", status: done, text: `Смотрю ${short(file || "каталог")}` };
    case "todowrite": case "todoread": return null;
    default: return { id, kind: "tool", status: done, text: `Инструмент ${short(tool || "без названия")}` };
  }
}

/** Сводит поток событий задачи к шагам для человека и последнему ответу агента. */
export function workspaceProgress(events: WorkspaceEvent[]): WorkspaceProgress {
  const steps = new Map<string, WorkspaceStep>();
  const assistant = new Set<string>();
  const texts = new Map<string, { message: string; value: string }>();
  let lastAssistantMessage = "";
  steps.set("clone", { id: "clone", kind: "clone", status: "running", text: "Готовлю рабочее место и клонирую репозиторий" });
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const data = record(event.data);
    if (event.type === "workspace.state") {
      const state = text(data.state);
      if (state && state !== "starting") steps.get("clone")!.status = state === "failed" ? "error" : "done";
      if (state === "stopped" || state === "failed") {
        const reason = short(text(data.reason));
        steps.set(`state:${event.seq}`, { id: `state:${event.seq}`, kind: "state", status: state === "failed" ? "error" : "done", text: state === "failed" ? `Задача завершилась с ошибкой${reason ? `: ${reason}` : ""}` : `Задача остановлена${reason ? `: ${reason}` : ""}` });
      }
      continue;
    }
    if (event.type === "message.updated") {
      const info = record(data.info);
      if (text(info.role) === "assistant" && text(info.id)) { assistant.add(text(info.id)); lastAssistantMessage = text(info.id); }
      continue;
    }
    if (event.type !== "message.part.updated") continue;
    const part = record(data.part);
    if (text(part.type) === "tool") {
      steps.get("clone")!.status = steps.get("clone")!.status === "error" ? "error" : "done";
      const step = toolStep(part);
      if (step?.id) steps.set(step.id, step);
    } else if (text(part.type) === "text" && text(part.id)) {
      texts.set(text(part.id), { message: text(part.messageID), value: text(part.text) });
    }
  }
  const answers = [...texts.values()].filter(t => assistant.has(t.message) && t.value.trim());
  const last = answers.filter(t => t.message === lastAssistantMessage);
  const answer = (last.length ? last : answers.slice(-1)).map(t => t.value.trim()).join("\n\n");
  const list = [...steps.values()];
  return { steps: list.length > MAX_STEPS ? [list[0], ...list.slice(-(MAX_STEPS - 1))] : list, answer };
}
