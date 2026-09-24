import type { Usage } from "@earendil-works/pi-ai";
import { usdToMicros, type SpendingEntry } from "@gadgets/workshop-shared/spending";

/** Цена одного обращения к модели: из ответа поставщика, а если он её не назвал — оценка по каталогу. */
export type ModelSpend = {
  usd: number;
  estimated: boolean;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** Запрос идёт в OpenRouter (прямо или через совместимый адрес): в ответе есть usage.cost. */
export function isOpenRouterUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try { return new URL(baseUrl).hostname === "openrouter.ai"; } catch { return false; }
}

/** Цена из разобранного фрагмента ответа: usage.cost у chat/completions и у systemone,
 *  response.usage.cost у Responses API. */
export function usageCostOf(value: unknown): number | undefined {
  const v = value as {usage?: {cost?: unknown}; response?: {usage?: {cost?: unknown}}} | null;
  const cost = v?.usage?.cost ?? v?.response?.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

/** Обёртка fetch, которая пропускает ответ без изменений и по пути читает цену поставщика.
 *  Для потока SSE цена приходит в последнем фрагменте; для обычного JSON — в теле целиком.
 *  onCost получает прирост: повтор той же цены в ответе не удваивает трату. */
export function providerCostFetch(base: typeof fetch, onCost: (usd: number) => void): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await base(input, init);
    if (!response.body) return response;
    const sse = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    const decoder = new TextDecoder();
    let buffer = "", reported = 0;
    const found = (text: string) => {
      const data = text.trim().replace(/^data:\s*/, "");
      if (!data.includes("\"cost\"")) return;
      try {
        const cost = usageCostOf(JSON.parse(data));
        if (cost !== undefined && cost > reported) { onCost(cost - reported); reported = cost; }
      } catch { /* не JSON — не цена */ }
    };
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, {stream: true});
        if (!sse) return;
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) { found(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      },
      flush() { buffer += decoder.decode(); if (buffer) found(buffer); },
    }));
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
  }) as typeof fetch;
}

/** Трата одного обращения по ручке модели: фактическая цена поставщика, если её прочитали. */
export function modelSpend(handle: {model: {id: string; provider: string}; lastProviderCostUsd?: number},
                           usage: Usage | undefined): ModelSpend {
  const provider = handle.lastProviderCostUsd;
  return {
    usd: provider ?? usage?.cost.total ?? 0,
    estimated: provider === undefined,
    provider: handle.model.provider,
    model: handle.model.id,
    inputTokens: (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0),
    outputTokens: usage?.output ?? 0,
  };
}

/** Запись для единого учёта Mnemos. */
export function spendingEntry(id: string, kind: SpendingEntry["kind"], operation: string, spend: ModelSpend,
                              projectId?: string, at = new Date()): SpendingEntry {
  return {
    record_id: id.slice(0, 255),
    occurred_at: at.toISOString(),
    kind,
    operation,
    provider: (spend.provider || "unknown").slice(0, 64),
    model: (spend.model || "unknown").slice(0, 255),
    ...(projectId ? {project_id: projectId} : {}),
    micro_usd: usdToMicros(spend.usd),
    estimated: spend.estimated,
    ...(spend.inputTokens > 0 ? {input_tokens: Math.round(spend.inputTokens)} : {}),
    ...(spend.outputTokens > 0 ? {output_tokens: Math.round(spend.outputTokens)} : {}),
  };
}
