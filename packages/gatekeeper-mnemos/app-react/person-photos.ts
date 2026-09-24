import type { HostStub } from "./host.ts";

// Фото людей во фрейме — один кэш на все экраны. Сети у фрейма нет (CSP: connect-src 'none',
// img-src только blob:): байты скачивает оболочка, фрейм получает их через host.personPhotos и
// делает blob:-адрес. Запросы одного прохода отрисовки собираются в один вызов моста; через 10 минут
// фото перезапрашивается, адрес меняется, только если сменилась сумма фото.

export const PHOTO_FRESH_MS = 10 * 60 * 1000;
const BATCH = 200;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Photo = { sha256: string; type: string; bytes: Uint8Array } | null;
type Entry = { at: number; sha: string; url: string | null; loading: boolean };

const EMPTY: Entry = { at: 0, sha: "", url: null, loading: false };
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
let queued: { host: HostStub; ids: Set<string> } | null = null;

export function photoEntry(id: string): Entry { return entries.get(id) ?? EMPTY; }

export function subscribePhoto(id: string, listener: () => void): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, set = new Set());
  set.add(listener);
  return () => { set.delete(listener); };
}

function settle(id: string, entry: Entry, photo: Photo | undefined) {
  if (entries.get(id) !== entry) return;
  let next: Entry;
  if (photo === undefined) next = { ...entry, at: Date.now(), loading: false }; // сбой моста: прежнее фото остаётся
  else if (photo && typeof photo.sha256 === "string" && TYPES.has(photo.type) && photo.bytes instanceof Uint8Array && photo.bytes.byteLength) {
    if (photo.sha256 === entry.sha && entry.url) next = { ...entry, at: Date.now(), loading: false };
    else {
      if (entry.url) URL.revokeObjectURL(entry.url);
      next = { at: Date.now(), sha: photo.sha256, url: URL.createObjectURL(new Blob([photo.bytes as BlobPart], { type: photo.type })), loading: false };
    }
  } else {
    if (entry.url) URL.revokeObjectURL(entry.url);
    next = { at: Date.now(), sha: "", url: null, loading: false };
  }
  entries.set(id, next);
  for (const l of listeners.get(id) ?? []) l();
}

async function flush() {
  const batch = queued;
  queued = null;
  if (!batch) return;
  const ids = [...batch.ids];
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH);
    const pending = part.map(id => entries.get(id)!);
    let answers: Photo[] | undefined;
    try {
      const result = await batch.host.personPhotos(part);
      answers = Array.isArray(result) && result.length === part.length ? result as Photo[] : undefined;
    } catch { answers = undefined; }
    part.forEach((id, n) => settle(id, pending[n]!, answers?.[n]));
  }
}

/** Запросить фото человека, если его нет в кэше или срок истёк. Запросы одного прохода идут одним вызовом. */
export function requestPhoto(host: HostStub, id: string, now = Date.now()) {
  const previous = entries.get(id);
  if (previous && (previous.loading || now - previous.at < PHOTO_FRESH_MS)) return;
  entries.set(id, { ...(previous ?? EMPTY), loading: true });
  if (!queued || queued.host !== host) {
    void flush();
    queued = { host, ids: new Set() };
    setTimeout(() => void flush(), 0);
  }
  queued.ids.add(id);
}

/** Для тестов: забыть фото. */
export function forgetPersonPhotos() {
  for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  entries.clear();
  queued = null;
}
