// Живой ход агента в Telegram: текст черновика (sendMessageDraft) из промежуточного состояния хода
// и ограничение частоты черновиков.
//
// Подписи шагов — короткая выжимка из реестра отображения экрана беседы
// (workshop-frontend/src/components/chat/toolDisplay.ts): тот же глагол настоящего времени для
// тех же методов библиотеки MNEMOS. Полный реестр живёт во фронтенде, сюда перенесено только то,
// что нужно для одной строки «что делаю».

import type { GadgetProgress } from "@gadgets/workshop-shared/external-message-gateway";
import { MAX_MESSAGE } from "./bot-api";

/** Telegram: не чаще 20 черновиков за 5 секунд (ADR 0027 Mnemos, п. 3). */
export const DRAFT_LIMIT = 20;
export const DRAFT_WINDOW_MS = 5_000;

const MNEMOS_METHODS: [RegExp, string][] = [
  [/\.(search|searchProject)\s*\(/, "Ищу в Mnemos…"],
  [/\.(readDocument|readPersonalDocument)\s*\(/, "Читаю документ…"],
  [/\.(browseProject|listProjects|listPersonalDocuments)\s*\(/, "Смотрю проекты и папки Mnemos…"],
  [/\.(createDraft)\s*\(/, "Создаю документ…"],
  [/\.(saveDraft|setDocument|applyOperation|mutateDocument)\s*\(/, "Меняю документ…"],
  [/\.(getDocument)\s*\(/, "Читаю документ…"],
  [/\.(publishDraft|publishReviewed)\s*\(/, "Готовлю публикацию…"],
  [/\.(readTracker)\s*\(/, "Открываю трекер задач…"],
  [/\.(changeTrackerTask)\s*\(/, "Меняю задачу в трекере…"],
];

const TOOLS: Record<string, string> = {
  readFile: "Читаю файл…",
  writeFile: "Записываю файл…",
  editFile: "Вношу правку…",
  describeBinding: "Смотрю подключение…",
  createGadget: "Создаю документ…",
  webFetch: "Открываю страницу…",
  listBlueprints: "Смотрю шаблоны…",
  listConnectableResources: "Смотрю, что можно подключить…",
  requestConnection: "Прошу подключить источник…",
  codeWork: "Поручаю работу агенту кода…",
  codeAsk: "Спрашиваю агента кода…",
  compacting: "Сжимаю историю беседы…",
};

/** Строка «что делаю» для идущего шага. */
export function describeStep(step: GadgetProgress["step"]): string {
  if (!step) return "Пишу ответ…";
  if (step.toolName === "executeCode") {
    let code = step.code ?? "";
    for (let [pattern, label] of MNEMOS_METHODS) if (pattern.test(code)) return label;
    return "Выполняю шаг…";
  }
  return TOOLS[step.toolName] ?? "Работаю…";
}

/** Текст черновика: шаг и, если модель уже пишет ответ, его хвост. */
export function draftText(progress: GadgetProgress): string {
  let text = typeof progress.text === "string" ? progress.text.trim() : "";
  if (!text) return describeStep(progress.step);
  let room = MAX_MESSAGE - 10;
  return text.length > room ? "…" + text.slice(-room) : text;
}

/** Скользящее окно: разрешает не больше limit событий за windowMs. */
export class DraftLimiter {
  #times: number[] = [];
  constructor(private limit = DRAFT_LIMIT, private windowMs = DRAFT_WINDOW_MS) {}

  allow(now: number): boolean {
    this.#times = this.#times.filter(time => now - time < this.windowMs);
    if (this.#times.length >= this.limit) return false;
    this.#times.push(now);
    return true;
  }
}
