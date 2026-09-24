// Маршрутизатор сообщений беседы в режиме «Код: Авто»: нейросеть Jev (OpenRouter, System One API)
// решает, кому отвечать на сообщение человека — агенту кода (OpenCode) или агенту беседы.
// Одно решение стоит порядка $0.00002 и занимает меньше секунды; при сбое беседа не ждёт.

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
};

export type JevDecision = {route: CodeRoute; confidence: number; cost?: number};
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

export function jevRequestBody(ctx: CodeRouteContext): string {
  return JSON.stringify({
    model: JEV_MODEL,
    state: codeRouteState(ctx),
    questions: {route: {type: "choice", instructions: INSTRUCTIONS, criteria: CRITERIA}},
  });
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
    let decision = parseJevAnswer(await response.json());
    return decision ? {ok: true, decision} : {ok: false, error: "bad_answer"};
  } catch {
    return {ok: false, error: controller.signal.aborted ? "timeout" : "network"};
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Настройки установки, из которых берётся ключ OpenRouter. */
export interface OpenRouterInstallConfig {
  MNEMOS_STT_API_KEY?: string;
  MNEMOS_STT_URL?: string;
  MNEMOS_STT_PROTOCOL?: string;
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
