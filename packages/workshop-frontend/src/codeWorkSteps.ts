// Шаги агента в ленте беседы: сводка «Работал … · N шагов · обращался к …» и обновление шагов
// по мере прихода.
import type { AgentStep } from "@gadgets/workshop-shared/code-work";
import { stepResources } from "@gadgets/workshop-shared/code-work";

/** Вставляет новый шаг или обновляет уже показанный с тем же id (шаг меняет состояние). */
export function upsertAgentStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  const index = steps.findIndex((s) => s.id === step.id);
  if (index < 0) return [...steps, step];
  const next = steps.slice();
  next[index] = step;
  return next;
}

export function russianPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10, mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${count} ${word}`;
}

export function formatWorkDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

const RESOURCE_WORDS: Record<NonNullable<AgentStep["resource"]>["kind"], [string, string, string]> = {
  file: ["файлу", "файлам", "файлам"],
  document: ["документу", "документам", "документам"],
  database: ["базе", "базам", "базам"],
  search: ["поиску", "поискам", "поискам"],
  command: ["команде", "командам", "командам"],
  web: ["странице", "страницам", "страницам"],
  project: ["проекту", "проектам", "проектам"],
};

/** «Работал 3 мин · 12 шагов · обращался к: 5 файлам, 2 документам». */
export function summarizeAgentSteps(steps: AgentStep[], durationMs?: number): string {
  const counted = steps.filter((s) => s.kind !== "state");
  const parts: string[] = [];
  if (durationMs !== undefined) parts.push(`Работал ${formatWorkDuration(durationMs)}`);
  parts.push(russianPlural(counted.length, "шаг", "шага", "шагов"));
  const resources = stepResources(counted)
    .filter((r) => r.kind !== "command")
    .map((r) => {
      const [one, few, many] = RESOURCE_WORDS[r.kind];
      // Дательный падеж после «к»: «к 1 файлу», «к 5 файлам».
      return russianPlural(r.names.length, one, few, many);
    });
  if (resources.length) parts.push(`обращался к: ${resources.join(", ")}`);
  return parts.join(" · ");
}

/** Число строк, изменённых шагами, для подписи «+12 −3». */
export function stepLineTotals(steps: AgentStep[]): { additions: number; deletions: number } {
  let additions = 0, deletions = 0;
  for (const s of steps) {
    additions += s.additions ?? 0;
    deletions += s.deletions ?? 0;
  }
  return { additions, deletions };
}

/** Состояние беседы для списка: работает любой из агентов, результат ждёт человека и т. п. */
export function chatListState(chat: {
  activeAgent?: unknown;
  hasProposedChanges?: boolean;
  codeWork?: { review?: { outcome: string } };
}): "working" | "review" | "awaiting" | "proposed" | null {
  if (chat.activeAgent) return "working";
  const outcome = chat.codeWork?.review?.outcome;
  if (outcome === "draft") return "review";
  if (outcome === "awaiting_approval") return "awaiting";
  if (chat.hasProposedChanges) return "proposed";
  return null;
}
