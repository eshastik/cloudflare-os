// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInput } from "./VoiceInput";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class Recorder extends EventTarget {
  static latest: Recorder;
  static isTypeSupported(type: string) { return type.startsWith("audio/webm"); }
  state = "inactive"; mimeType = "audio/webm;codecs=opus";
  ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
  constructor() { super(); Recorder.latest = this; }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; queueMicrotask(() => { this.dispatchEvent(new MessageEvent("dataavailable", {data:new Blob(["voice"])})); this.dispatchEvent(new Event("stop")); }); }
}
describe("Голосовой ввод", () => {
  let root: Root, host: HTMLDivElement;
  const stop = vi.fn<() => void>(), getUserMedia = vi.fn<() => Promise<unknown>>(), onText = vi.fn<(text:string) => void>(), onBusyChange = vi.fn<(busy:boolean) => void>();
  const api = { isChatVoiceAvailable: vi.fn<() => Promise<boolean>>(async () => true), transcribeChatVoice: vi.fn<(bytes:Uint8Array, mediaType:string) => Promise<string>>(async () => "Подготовь отчёт") };
  async function click(label: string) { await act(async () => { (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click(); }); }
  beforeEach(async () => {
    vi.stubGlobal("MediaRecorder", Recorder);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] }); api.isChatVoiceAvailable.mockResolvedValue(true);
    Object.defineProperty(Blob.prototype, "arrayBuffer", { configurable: true, value: async () => new Uint8Array([1, 2]).buffer });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(React.createElement(VoiceInput, { api, disabled: false, onText, onBusyChange })));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("не запрашивает микрофон до клика и отдаёт текст только после остановки", async () => {
    expect(getUserMedia).not.toHaveBeenCalled(); await click("Записать голосовое сообщение");
    expect(onText).not.toHaveBeenCalled(); expect(api.transcribeChatVoice).not.toHaveBeenCalled();
    await click("Завершить запись");
    expect(onText).toHaveBeenCalledWith("Подготовь отчёт"); expect(stop).toHaveBeenCalled();
    expect(host.textContent).toContain("Проверьте текст");
  });
  it("отмена не передаёт записанное провайдеру", async () => {
    await click("Записать голосовое сообщение"); await click("Отменить голосовое сообщение");
    expect(stop).toHaveBeenCalled(); expect(api.transcribeChatVoice).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
  });
  it("отмена во время разрешения освобождает поздно полученный микрофон", async () => {
    let resolve!: (stream: unknown) => void; getUserMedia.mockReturnValueOnce(new Promise(r => resolve = r));
    await click("Записать голосовое сообщение"); await click("Отменить голосовое сообщение");
    await act(async () => resolve({ getTracks: () => [{ stop }] })); expect(stop).toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled();
  });
  it("недоступная настройка не запрашивает разрешение микрофона", async () => {
    api.isChatVoiceAvailable.mockResolvedValue(false); await click("Записать голосовое сообщение");
    expect(getUserMedia).not.toHaveBeenCalled(); expect(host.textContent).toContain("пока не настроен");
  });
  it("уход со страницы освобождает микрофон без отправки", async () => {
    await click("Записать голосовое сообщение"); await act(async () => root.render(null));
    expect(stop).toHaveBeenCalled(); expect(api.transcribeChatVoice).not.toHaveBeenCalled();
  });
  it("отказ в микрофоне объясняет причину и не отправляет аудио", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await click("Записать голосовое сообщение");
    expect(host.textContent).toContain("Нет доступа к микрофону");
    expect(api.transcribeChatVoice).not.toHaveBeenCalled();
  });
  it("останавливает длинную запись через две минуты без ожидания реального времени", async () => {
    vi.useFakeTimers();
    try {
      await click("Записать голосовое сообщение");
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(stop).toHaveBeenCalled();
      expect(onText).toHaveBeenCalledWith("Подготовь отчёт");
    } finally { vi.useRealTimers(); }
  });
  it("после ошибки повторяет ту же запись только по кнопке", async () => {
    api.transcribeChatVoice.mockRejectedValueOnce(new Error("Сеть недоступна"));
    await click("Записать голосовое сообщение"); await click("Завершить запись");
    expect(api.transcribeChatVoice).toHaveBeenCalledTimes(1);
    expect(onText).not.toHaveBeenCalled();
    await act(async () => { Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Повторить распознавание")!.click(); });
    expect(api.transcribeChatVoice).toHaveBeenCalledTimes(2);
    expect(api.transcribeChatVoice.mock.calls[0]).toEqual(api.transcribeChatVoice.mock.calls[1]);
    expect(onText).toHaveBeenCalledWith("Подготовь отчёт");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Повторить распознавание");
  });
  it("поздний текст после отмены не попадает в следующее сообщение", async () => {
    let resolve!: (text: string) => void; api.transcribeChatVoice.mockReturnValueOnce(new Promise(r => resolve = r));
    await click("Записать голосовое сообщение"); await click("Завершить запись"); await click("Отменить голосовое сообщение");
    await act(async () => resolve("Опоздавшая запись")); expect(onText).not.toHaveBeenCalled();
  });
});
