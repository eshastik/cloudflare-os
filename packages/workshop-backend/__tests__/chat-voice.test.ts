import { describe, it, expect, vi } from "vitest";
import { transcribeChatVoice, chatVoiceAvailable } from "../src/chat-voice";
const config = { MNEMOS_STT_API_KEY: "private-key", MNEMOS_STT_URL: "https://speech.example/v1/audio/transcriptions", MNEMOS_STT_MODEL: "whisper-1" };
describe("Голосовой текст чата", () => {
  it("передаёт аудио только настроенному провайдеру и возвращает текст без выполнения", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      const form = init.body as FormData;
      expect(form.get("model")).toBe("whisper-1");
      expect(await (form.get("file") as File).text()).toBe("audio");
      return Response.json({ text: "  Подготовь договор  " });
    });
    expect(await transcribeChatVoice(config, new TextEncoder().encode("audio"), "audio/webm;codecs=opus", fetcher)).toBe("Подготовь договор");
    expect(fetcher.mock.calls[0][0]).toBe(config.MNEMOS_STT_URL);
  });
  it("использует отдельный OpenRouter STT без агентского промпта", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ model: "openai/whisper-large-v3", input_audio: { data: "YXVkaW8=", format: "m4a" } });
      return Response.json({ text: "Проверка" });
    });
    expect(await transcribeChatVoice({ ...config, MNEMOS_STT_PROTOCOL: "openrouter", MNEMOS_STT_MODEL: "openai/whisper-large-v3" }, new TextEncoder().encode("audio"), "audio/mp4", fetcher)).toBe("Проверка");
  });
  it("не обращается к провайдеру без настройки, с пустыми или слишком большими данными", async () => {
    const fetcher = vi.fn();
    expect(chatVoiceAvailable({})).toBe(false);
    for (const [cfg, bytes, type] of [[{}, new Uint8Array([1]), "audio/webm"], [config, new Uint8Array(), "audio/webm"], [config, new Uint8Array(8_000_001), "audio/webm"], [config, new Uint8Array([1]), "text/plain"]] as const) {
      await expect(transcribeChatVoice(cfg, bytes, type, fetcher)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("не раскрывает ответ провайдера или ключ в ошибке", async () => {
    const fetcher = vi.fn(async () => new Response("private-key provider internal", { status: 401 }));
    await expect(transcribeChatVoice(config, new Uint8Array([1]), "audio/mp4", fetcher)).rejects.toThrow("Не удалось распознать");
  });
  it("отклоняет небезопасный адрес и пустую расшифровку", async () => {
    expect(chatVoiceAvailable({ ...config, MNEMOS_STT_URL: "http://speech.example" })).toBe(false);
    await expect(transcribeChatVoice(config, new Uint8Array([1]), "audio/ogg", async () => Response.json({ text: " " }))).rejects.toThrow("Речь не распознана");
  });
});
