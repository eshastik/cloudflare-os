import { useEffect, useState, useSyncExternalStore } from "react";
import { useOptionalHost } from "./host.ts";
import { photoEntry, requestPhoto, subscribePhoto } from "./person-photos.ts";

// Единственный кружок человека во встроенном приложении. Экраны не рисуют инициалы сами:
// сторож app-react-person-avatar.test.mjs ищет самодельные кружки по исходникам.

const SIZES = { 22: "h-[22px] w-[22px] text-[9px]", 26: "h-[26px] w-[26px] text-[10px]", 32: "h-8 w-8 text-[12px]", 34: "h-[34px] w-[34px] text-[12px]" } as const;
export type PersonAvatarSize = keyof typeof SIZES;

// Те же тона, что у аватара оболочки (MnemosAvatar): человек узнаётся по цвету в обоих слоях.
const TONES = ["bg-selection-bg text-selection-text", "bg-kumo-warning-tint text-kumo-warning", "bg-kumo-info-tint text-kumo-default", "bg-kumo-tint text-kumo-default"];

export function avatarTone(id: string): string {
  return TONES[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TONES.length]!;
}

export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toLocaleUpperCase("ru-RU")).join("") || "?";
}

/** blob:-адрес фото человека или null, пока фото нет. Проверка срока — раз в минуту, пока экран открыт. */
export function usePersonPhoto(id: string | undefined): string | null {
  const host = useOptionalHost();
  const key = id ?? "";
  const entry = useSyncExternalStore(listener => key ? subscribePhoto(key, listener) : () => {}, () => photoEntry(key));
  useEffect(() => {
    if (!key || !host) return;
    requestPhoto(host, key);
    const timer = setInterval(() => requestPhoto(host, key), 60_000);
    return () => clearInterval(timer);
  }, [host, key]);
  return key ? entry.url : null;
}

/**
 * Аватар человека: фото, если оно есть, иначе инициалы; незагрузившееся фото тоже заменяется инициалами.
 * id — служебный ключ человека (principal_id); без него (приглашённый без учётной записи) — только инициалы.
 */
export default function PersonAvatar({ name, id, size = 32 }: { name: string; id?: string; size?: PersonAvatarSize }) {
  const photo = usePersonPhoto(id);
  const [broken, setBroken] = useState("");
  const show = !!photo && broken !== photo;
  return <span aria-hidden="true" data-avatar={show ? "photo" : "initials"}
    className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${SIZES[size]} ${show ? "bg-kumo-tint" : avatarTone(id || name)}`}>
    {show ? <img src={photo} alt="" draggable={false} onError={() => setBroken(photo)} className="h-full w-full object-cover" /> : initialsOf(name)}
  </span>;
}
