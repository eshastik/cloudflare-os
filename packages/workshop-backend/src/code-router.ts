// Маршрутизатор сообщений беседы в режиме «Код: Авто»: нейросеть Jev (OpenRouter, System One API)
// решает, кому отвечать на сообщение человека — агенту кода (OpenCode) или агенту беседы.
// Одно решение стоит порядка $0.00002 и занимает меньше секунды; при сбое беседа не ждёт.

import type {AiModelConfig} from "@gadgets/workshop-shared/api";

export const JEV_URL = "https://openrouter.ai/api/v1/systemone";
export const JEV_MODEL = "jev-1.13";
/** Ниже этой уверенности сообщение идёт агенту беседы: он сам решит, звать ли агента кода. */
export const JEV_CONFIDENCE_THRESHOLD = 0.6;
export const JEV_TIMEOUT_MS = 3_000;
const MAX_REPLY = 500;
const MAX_MESSAGE = 4_000;
const MAX_TOPIC = 800;

export type CodeRoute = "code" | "chat";

/** Что маршрутизатор знает о беседе, кроме самого сообщения. */
export type CodeRouteContext = {
  message: string;
  /** Живая работа с кодом: проект и тема (итог последнего хода агента кода). */
  work?: {projectTitle: string; topic?: string};
  /** Последний ответ дал агент кода. */
  lastReplyByCode: boolean;
  /** Последняя реплика агента в беседе (любого). */
  lastAgentReply?: string;
  /** Проекты беседы с подключённым кодом. */
  codeProjects: string[];
  /** Проекты человека, которые Jev может подключить к беседе или убрать из неё. */
  projectCandidates?: {title: string; pinned: boolean; hasCode: boolean}[];
};

/** projects — решение по каждому кандидату projectCandidates (по индексу): нужен ли он беседе. */
export type JevProjectDecision = {index: number; include: boolean; confidence: number};
export type JevDecision = {route: CodeRoute; confidence: number; cost?: number; projects?: JevProjectDecision[]};
export type JevResult = {ok: true; decision: JevDecision} | {ok: false; error: string};

function clip(text: string, max: number): string {
  let t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Текст state для Jev: сообщение и обстановка беседы, по-русски. */
export function codeRouteState(ctx: CodeRouteContext): string {
  let lines = [`Новое сообщение человека: «${clip(ctx.message, MAX_MESSAGE)}»`, ""];
  if (ctx.work) {
    lines.push(`Сейчас идёт работа с кодом проекта «${ctx.work.projectTitle}».`);
    if (ctx.work.topic?.trim()) lines.push(`Тема работы с кодом: ${clip(ctx.work.topic, MAX_TOPIC)}`);
  } else {
    lines.push("Работа с кодом сейчас не идёт.");
  }
  lines.push(ctx.codeProjects.length
    ? `Проекты беседы с кодом: ${ctx.codeProjects.map(p => `«${p}»`).join(", ")}.`
    : "В беседе нет проекта с кодом.");
  if (ctx.projectCandidates?.length) {
    let pinned = ctx.projectCandidates.filter(p => p.pinned);
    lines.push(pinned.length ? `Сейчас к беседе подключены проекты: ${pinned.map(p => `«${p.title}»`).join(", ")}.` : "Сейчас к беседе не подключён ни один проект.");
    lines.push(`Все проекты человека: ${ctx.projectCandidates.map(p => `«${p.title}»${p.hasCode ? " (есть код)" : ""}`).join(", ")}.`);
  }
  if (ctx.lastAgentReply?.trim()) {
    lines.push(`Предыдущий ответ дал ${ctx.lastReplyByCode ? "агент кода" : "агент беседы"}: «${clip(ctx.lastAgentReply, MAX_REPLY)}»`);
  }
  return lines.join("\n");
}

const INSTRUCTIONS = [
  "Реши, кто должен ответить на новое сообщение человека в рабочей беседе.",
  "Агент кода работает в репозитории проекта: читает и меняет файлы, запускает команды, тесты и сборку.",
  "Агент беседы разговаривает с человеком: объясняет, пересказывает, отвечает на общие вопросы, работает с документами, почтой, календарём и памятью организации.",
  "Учитывай обстановку беседы. Если идёт работа с кодом, короткие продолжения вроде «а теперь запусти тесты», «поправь ещё заголовок», «почему упало?» — к агенту кода.",
  "Благодарности, просьбы объяснить проще, пересказать сделанное или обсудить без изменения кода — к агенту беседы.",
].join(" ");

const CRITERIA: Record<CodeRoute, string> = {
  code: "Нужно действие с кодом проекта: найти, прочитать, изменить или создать файлы, исправить ошибку, запустить команды, тесты или сборку, ответить на вопрос об устройстве кода, для которого надо заглянуть в репозиторий, или продолжить текущую работу с кодом.",
  chat: "Разговор без работы в репозитории: благодарность, приветствие, просьба объяснить или пересказать уже сделанное простыми словами, общий вопрос, вопрос не про код, работа с документами, почтой, календарём или памятью организации.",
};

/** Сколько проектов человека спрашивается у Jev за одно сообщение: подключённые идут первыми. */
export const MAX_PROJECT_CANDIDATES = 24;

function projectQuestion(title: string, pinned: boolean) {
  return {
    type: "choice",
    instructions: `Нужен ли беседе проект «${title}», чтобы ответить на новое сообщение и продолжить разговор? ` +
      `Сейчас он ${pinned ? "подключён" : "не подключён"}. Учитывай названия по-русски и по-английски, сокращения и склонения, ` +
      "тему всей беседы, а не только последнего сообщения. Подключённый проект, о котором говорили раньше, не убирай из-за короткой реплики.",
    criteria: {
      yes: "Сообщение или тема беседы касается этого проекта: его документов, кода, людей или дел.",
      no: "Беседа не касается этого проекта.",
    },
  };
}

export function jevRequestBody(ctx: CodeRouteContext): string {
  let questions: Record<string, unknown> = {route: {type: "choice", instructions: INSTRUCTIONS, criteria: CRITERIA}};
  (ctx.projectCandidates ?? []).slice(0, MAX_PROJECT_CANDIDATES)
    .forEach((p, i) => { questions[`p${i}`] = projectQuestion(p.title, p.pinned); });
  return JSON.stringify({model: JEV_MODEL, state: codeRouteState(ctx), questions});
}

/** Решения Jev по проектам-кандидатам; вопрос без разборчивого ответа пропускается. */
export function parseJevProjects(value: unknown, count: number): JevProjectDecision[] {
  let answers = (value as {answers?: Record<string, {choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown>}>})?.answers ?? {};
  let out: JevProjectDecision[] = [];
  for (let index = 0; index < Math.min(count, MAX_PROJECT_CANDIDATES); index++) {
    let answer = answers[`p${index}`];
    let choice = answer?.choice;
    if (choice !== "yes" && choice !== "no") continue;
    let confidence = typeof answer!.confidence === "number" ? answer!.confidence : answer!.probabilities?.[choice];
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    out.push({index, include: choice === "yes", confidence: Math.min(1, Math.max(0, confidence))});
  }
  return out;
}

/** Разбор ответа System One. null — ответ не того вида. */
export function parseJevAnswer(value: unknown): JevDecision | null {
  let answer = (value as {answers?: {route?: {choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown>}}})?.answers?.route;
  let route = answer?.choice;
  if (route !== "code" && route !== "chat") return null;
  let confidence = typeof answer!.confidence === "number" ? answer!.confidence : answer!.probabilities?.[route];
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  let cost = (value as {usage?: {cost?: unknown}}).usage?.cost;
  return {route, confidence: Math.min(1, Math.max(0, confidence)),
    ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? {cost} : {})};
}

export type JevRequest = {
  apiKey: string;
  context: CodeRouteContext;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Один вопрос к Jev. Не бросает: ошибка возвращается коротким кодом без текста сообщения и ключа. */
export async function askJev(request: JevRequest): Promise<JevResult> {
  let fetcher = request.fetcher ?? fetch;
  let controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), request.timeoutMs ?? JEV_TIMEOUT_MS);
  let onOuterAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onOuterAbort, {once: true});
  try {
    let response = await fetcher(JEV_URL, {
      method: "POST",
      headers: {Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json"},
      body: jevRequestBody(request.context),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) return {ok: false, error: `http_${response.status}`};
    let body = await response.json();
    let decision = parseJevAnswer(body);
    if (!decision) return {ok: false, error: "bad_answer"};
    let count = request.context.projectCandidates?.length ?? 0;
    return {ok: true, decision: count ? {...decision, projects: parseJevProjects(body, count)} : decision};
  } catch {
    return {ok: false, error: controller.signal.aborted ? "timeout" : "network"};
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Быстрая модель установки для служебных задач (названия бесед, перевод размышлений), если
 *  человек не выбрал свою: та же модель и те же провайдеры OpenRouter, что у агента кода
 *  (решение владельца 2026-09-23, mnemos services/internal/workspace/config.go). */
export const QUICK_MODEL = "deepseek/deepseek-v4-flash-0731";
export const QUICK_MODEL_PROVIDERS = ["baseten/fp8", "wafer/fast", "coreweave/fp8", "parasail/fp8"];

export function installationQuickModel(env: OpenRouterInstallConfig): AiModelConfig | undefined {
  let apiToken = installationOpenRouterKey(env);
  return apiToken ? {provider: "openai", model: QUICK_MODEL, apiToken, apiUrl: "https://openrouter.ai/api/v1",
    openRouter: {order: QUICK_MODEL_PROVIDERS, allowFallbacks: false}} : undefined;
}

/** Модель бесед установки: есть у каждого человека без настройки (решение владельца — «сел и
 *  поехал»). Имя модели OpenRouter — MNEMOS_CHAT_MODEL, ключ — ключ OpenRouter установки. Своя
 *  модель человека с тем же id главнее. */
export const INSTALLATION_CHAT_MODEL_ID = "mnemos-assistant";

export function installationChatModel(env: OpenRouterInstallConfig):
    {profile: {type: "agent"; id: string; name: string}; config: AiModelConfig} | undefined {
  let model = env.MNEMOS_CHAT_MODEL?.trim();
  let apiToken = installationOpenRouterKey(env);
  if (!model || !apiToken) return undefined;
  return {
    profile: {type: "agent", id: INSTALLATION_CHAT_MODEL_ID, name: "Mnemos Assistant"},
    config: {provider: "openai", model, apiToken, apiUrl: "https://openrouter.ai/api/v1"},
  };
}

/** Настройки установки, из которых берётся ключ OpenRouter. */
export interface OpenRouterInstallConfig {
  MNEMOS_STT_API_KEY?: string;
  MNEMOS_STT_URL?: string;
  MNEMOS_STT_PROTOCOL?: string;
  MNEMOS_CHAT_MODEL?: string;
}

/** Ключ OpenRouter установки. Отдельной переменной ключа OpenRouter для моделей нет (модели
 *  беседы настраиваются по пользователям), поэтому берётся ключ распознавания речи — но только
 *  если распознавание идёт через OpenRouter: чужой ключ в OpenRouter не отправляется. */
export function installationOpenRouterKey(env: OpenRouterInstallConfig): string | undefined {
  let key = env.MNEMOS_STT_API_KEY?.trim();
  if (!key) return undefined;
  if (env.MNEMOS_STT_PROTOCOL === "openrouter") return key;
  try {
    return env.MNEMOS_STT_URL && new URL(env.MNEMOS_STT_URL).hostname === "openrouter.ai" ? key : undefined;
  } catch {
    return undefined;
  }
}
