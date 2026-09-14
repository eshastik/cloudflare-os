/** Серверные настройки распознавания; клиент не выбирает адрес или модель. */
export interface ChatVoiceConfig {
  MNEMOS_STT_API_KEY?: string;
  MNEMOS_STT_URL?: string;
  MNEMOS_STT_MODEL?: string;
  MNEMOS_STT_PROTOCOL?: string;
}
const formats: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/mpeg": "mp3" };
/** Проверка настройки до запроса разрешения на микрофон. */
export function chatVoiceAvailable(config: ChatVoiceConfig): boolean {
  if (!config.MNEMOS_STT_API_KEY || !config.MNEMOS_STT_MODEL || !config.MNEMOS_STT_URL) return false;
  if (config.MNEMOS_STT_PROTOCOL && !["openai", "openrouter"].includes(config.MNEMOS_STT_PROTOCOL)) return false;
  try { const url = new URL(config.MNEMOS_STT_URL); return url.protocol === "https:" && !url.username && !url.password && !url.hash; } catch { return false; }
}
/** Расшифровка возвращается только как редактируемый текст, без выполнения поручения. */
export async function transcribeChatVoice(config: ChatVoiceConfig, bytes: Uint8Array, mediaType: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<string> {
  if (!chatVoiceAvailable(config)) throw new Error("Голосовой ввод пока не настроен. Напишите сообщение текстом.");
  const mime = mediaType.split(";")[0].trim().toLowerCase(), format = formats[mime];
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 8_000_000 || !format) {
    throw new Error("Не удалось прочитать запись. Запишите сообщение заново.");
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${config.MNEMOS_STT_API_KEY}` };
  let body: FormData | string;
  if (config.MNEMOS_STT_PROTOCOL === "openrouter") {
    let binary = "";
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ model: config.MNEMOS_STT_MODEL, input_audio: { data: btoa(binary), format } });
  } else {
    const form = new FormData();
    form.set("model", config.MNEMOS_STT_MODEL!);
    form.set("file", new Blob([bytes.slice().buffer], { type: mime }), `voice.${format}`);
    form.set("response_format", "json"); body = form;
  }
  let response: Response;
  try {
    response = await fetcher(config.MNEMOS_STT_URL!, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(60_000) });
  } catch { throw new Error("Не удалось распознать запись. Попробуйте ещё раз."); }
  if (!response.ok) throw new Error("Не удалось распознать запись. Попробуйте ещё раз.");
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error("Не удалось распознать запись. Попробуйте ещё раз."); }
  const text = result && typeof result === "object" && "text" in result ? result.text : undefined;
  if (typeof text !== "string" || !text.trim()) throw new Error("Речь не распознана. Попробуйте говорить ближе к микрофону.");
  if (text.length > 40_000) throw new Error("Запись слишком длинная. Разделите сообщение на части.");
  return text.trim();
}
