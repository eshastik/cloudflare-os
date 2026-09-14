import { useEffect, useRef, useState } from "react";
import { Microphone, Stop, X } from "@phosphor-icons/react";
import type { AuthenticatedApi } from "@gadgets/workshop-shared/api";

type VoiceApi = Pick<AuthenticatedApi, "isChatVoiceAvailable" | "transcribeChatVoice">;
/** Запись существует только до расшифровки; отправку сообщения контролирует обычный composer. */
export function VoiceInput({ api, disabled, onText, onBusyChange }: {
  api: VoiceApi; disabled: boolean; onText: (text: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [canRetry, setCanRetry] = useState(false);
  const pendingAudio = useRef<{bytes: Uint8Array; mediaType: string} | null>(null);
  const session = useRef(0), recording = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const callbacks = useRef({ onText, onBusyChange }); callbacks.current = { onText, onBusyChange };
  function release() {
    if (timer.current) clearInterval(timer.current); timer.current = null;
    const recorder = recording.current; recording.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
  }
  function cancel() { session.current++; pendingAudio.current = null; setCanRetry(false); release(); setPhase("idle"); setNotice(""); callbacks.current.onBusyChange(false); }
  useEffect(() => () => { session.current++; pendingAudio.current = null; release(); callbacks.current.onBusyChange(false); }, []);
  async function recognizeSaved(id: number) {
    const audio = pendingAudio.current;
    if (!audio || session.current !== id) return;
    setPhase("transcribing"); setCanRetry(false); setNotice(""); callbacks.current.onBusyChange(true);
    try {
      const text = await api.transcribeChatVoice(audio.bytes, audio.mediaType);
      if (session.current !== id) return;
      pendingAudio.current = null;
      callbacks.current.onText(text); setNotice("Проверьте текст и отправьте сообщение.");
    } catch (error) {
      if (session.current === id) {
        setCanRetry(true);
        setNotice(error instanceof Error ? error.message : "Не удалось распознать запись.");
      }
    } finally {
      if (session.current === id) { setPhase("idle"); callbacks.current.onBusyChange(false); }
    }
  }
  async function start() {
    if (disabled || phase !== "idle") return;
    pendingAudio.current = null; setCanRetry(false);
    const id = ++session.current; setNotice(""); setPhase("starting"); callbacks.current.onBusyChange(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Этот браузер не поддерживает запись. Напишите сообщение текстом.");
      if (!await api.isChatVoiceAvailable()) throw new Error("Голосовой ввод пока не настроен. Напишите сообщение текстом.");
      if (session.current !== id) return;
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session.current !== id) { mic.getTracks().forEach(track => track.stop()); return; }
      stream.current = mic;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("Формат записи браузера не поддерживается.");
      const recorder = new MediaRecorder(mic, { mimeType: mime }); recording.current = recorder;
      const chunks: Blob[] = []; let size = 0;
      recorder.addEventListener("dataavailable", event => {
        if (session.current !== id || !event.data.size) return;
        size += event.data.size;
        if (size > 8_000_000) { cancel(); setNotice("Запись слишком большая. Запишите сообщение короче."); return; }
        chunks.push(event.data);
      });
      recorder.addEventListener("error", () => { if (session.current === id) { cancel(); setNotice("Запись прервалась. Попробуйте ещё раз."); } });
      recorder.addEventListener("stop", () => {
        if (session.current !== id) return;
        release();
        setPhase("transcribing");
        void (async () => {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (blob.size === 0) throw new Error("Запись пуста. Попробуйте ещё раз.");
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (session.current !== id) return;
          pendingAudio.current = {bytes, mediaType: recorder.mimeType};
          await recognizeSaved(id);
        })().catch(error => { if (session.current === id) setNotice(error instanceof Error ? error.message : "Не удалось распознать запись."); })
          .finally(() => { if (session.current === id) { setPhase("idle"); callbacks.current.onBusyChange(false); } });
      });
      recorder.start(1000); setSeconds(0); setPhase("recording");
      let elapsed = 0;
      timer.current = setInterval(() => { elapsed++; setSeconds(elapsed); if (elapsed >= 120) release(); }, 1000);
    } catch (error) {
      if (session.current !== id) return; release(); setPhase("idle"); callbacks.current.onBusyChange(false);
      setNotice(error instanceof DOMException && error.name === "NotAllowedError" ? "Нет доступа к микрофону. Разрешите его в настройках браузера." : error instanceof Error ? error.message : "Не удалось начать запись.");
    }
  }
  const busy = phase !== "idle";
  return <div className="flex items-center gap-1.5">
    {busy && <span role="status" className="text-xs text-kumo-subtle">{phase === "recording" ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} / 2:00` : phase === "starting" ? "Микрофон…" : "Распознаю…"}</span>}
    {phase === "idle" && <button type="button" aria-label="Записать голосовое сообщение" title="Голосовое сообщение" disabled={disabled} onClick={() => void start()} className="flex h-8 w-8 items-center justify-center rounded-lg text-kumo-subtle hover:bg-kumo-tint disabled:opacity-40"><Microphone size={19} /></button>}
    {phase === "recording" && <button type="button" aria-label="Завершить запись" onClick={release} className="flex h-8 w-8 items-center justify-center rounded-lg bg-kumo-brand text-white"><Stop size={16} weight="fill" /></button>}
    {busy && <button type="button" aria-label="Отменить голосовое сообщение" onClick={cancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-kumo-subtle hover:bg-kumo-tint"><X size={17} /></button>}
    {notice && <div role="status" className="absolute inset-x-3 bottom-full mb-2 rounded-xl border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-subtle shadow-sm">{notice}{canRetry && <button type="button" disabled={disabled} onClick={() => void recognizeSaved(++session.current)} className="ml-2 font-medium text-kumo-brand">Повторить распознавание</button>}<button type="button" aria-label="Закрыть подсказку голосового ввода" onClick={cancel} className="ml-2 inline-flex align-middle"><X size={14} /></button></div>}
  </div>;
}
