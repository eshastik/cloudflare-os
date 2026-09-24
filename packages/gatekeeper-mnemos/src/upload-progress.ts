// Ход загрузки файлов: состояние, которое оболочка передаёт приложению во фрейме, сглаженная
// скорость и подписи. Файлы не передаются: только числа, имена и пути, которые фрейм и так видит
// в итогах приёма.

import type { SkippedGroup } from "./upload-filter.ts";

/** Что показывает уведомление о загрузке. id отличает одну загрузку от следующей. */
export type UploadView =
  | { phase: "reading"; id: number; project: string }
  | {
      phase: "confirm"; id: number; project: string;
      /** Имя выбранной папки; пусто — выбраны отдельные файлы. */
      folder: string; files: number; bytes: number;
      skipped: number; skippedMore: boolean; groups: SkippedGroup[];
    }
  | {
      phase: "uploading"; id: number; project: string;
      /** Имя выбранной папки; пусто — отдельные файлы. */
      folder: string;
      files: number; bytes: number;
      /** Обработано: принятые и окончательно не принятые файлы. */
      doneFiles: number; doneBytes: number;
      failed: number;
      /** Путь файла, который сейчас идёт в хранилище. */
      current: string;
      /** Байт в секунду, сглажено; 0 — ещё не измерено. */
      speed: number;
      /** Секунд до конца; null — ещё не измерено. */
      eta: number | null;
      stopping: boolean;
    }
  | {
      phase: "done"; id: number; project: string;
      files: number; accepted: number; acceptedBytes: number;
      /** Не принятые файлы: первые пути и полное число. */
      failed: string[]; failedCount: number;
      /** Не начатые из-за «Остановить». */
      stopped: number;
      /** Файлы легли личными черновиками проекта. */
      personal: boolean;
      note: string;
    }
  | { phase: "error"; id: number; project: string; message: string };

/** Сколько путей не принятых файлов отдавать фрейму: полный список бывает в тысячи строк. */
export const FAILED_PATHS_SHOWN = 50;

/**
 * Скорость по завершённым байтам со сглаживанием по времени: скачок от одного большого файла
 * не прыгает в подписи, а медленный участок постепенно тянет скорость вниз.
 */
export class SpeedMeter {
  #last: { at: number; bytes: number } | null = null;
  #started: number | null = null;
  #speed = 0;
  constructor(private readonly halfLifeMs = 4000, private readonly warmupMs = 1500) {}

  /** bytes — всего обработано к моменту now (мс). Возвращает сглаженную скорость, байт/с. */
  sample(bytes: number, now: number): number {
    if (!this.#last) { this.#last = { at: now, bytes }; this.#started = now; return this.#speed; }
    const dt = now - this.#last.at;
    if (dt <= 0) return this.#speed;
    const instant = Math.max(0, bytes - this.#last.bytes) * 1000 / dt;
    // Вес нового замера растёт с длиной промежутка: частые замеры не перевешивают редкие.
    const weight = 1 - Math.pow(0.5, dt / this.halfLifeMs);
    this.#speed = this.#speed === 0 ? instant : this.#speed + (instant - this.#speed) * weight;
    this.#last = { at: now, bytes };
    return this.#speed;
  }

  /** Секунды до конца или null, пока замеров мало. */
  eta(remainingBytes: number, now: number): number | null {
    if (this.#started === null || now - this.#started < this.warmupMs || this.#speed <= 0) return null;
    return Math.max(0, remainingBytes / this.#speed);
  }
}

/** Процент по байтам; пустые файлы считаются по числу файлов. */
export function uploadPercent(view: { bytes: number; doneBytes: number; files: number; doneFiles: number }): number {
  const ratio = view.bytes > 0 ? view.doneBytes / view.bytes : view.files > 0 ? view.doneFiles / view.files : 0;
  return Math.min(100, Math.max(0, Math.floor(ratio * 100)));
}

/** «3 670», «14 158»: разряды через неразрывный пробел. */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function oneDecimal(value: number): string {
  return (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)).replace(".", ",");
}

/** «138 из 407 МБ»; обе части в одной единице, чтобы их можно было сравнить глазом. */
export function bytesOf(done: number, total: number): string {
  const unit = total >= 1024 ** 3 ? { size: 1024 ** 3, name: "ГБ" } : total >= 1024 * 1024 ? { size: 1024 * 1024, name: "МБ" } : { size: 1024, name: "КБ" };
  const show = (bytes: number) => bytes >= 10 * unit.size ? groupDigits(bytes / unit.size) : oneDecimal(bytes / unit.size);
  return `${show(done)} из ${show(total)} ${unit.name}`;
}

/** Размер одним числом: «407 МБ», «1,2 ГБ», «840 КБ». */
export function bytesText(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${oneDecimal(bytes / 1024 ** 3)} ГБ`;
  if (bytes >= 1024 * 1024) return `${bytes >= 10 * 1024 * 1024 ? groupDigits(bytes / 1024 / 1024) : oneDecimal(bytes / 1024 / 1024)} МБ`;
  if (bytes >= 1024) return `${groupDigits(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

/** «2,4 МБ/с»; пусто, пока скорость не измерена. */
export function speedText(bytesPerSecond: number): string {
  if (!(bytesPerSecond > 0)) return "";
  return `${bytesText(bytesPerSecond)}/с`;
}

/** «осталось меньше минуты», «осталось ≈ 4 мин», «осталось ≈ 1 ч 20 мин». */
export function etaText(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return "осталось меньше минуты";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `осталось ≈ ${minutes} мин`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `осталось ≈ ${hours} ч${rest ? ` ${rest} мин` : ""}`;
}

/** Склонение по числу: plural(3, "файл", "файла", "файлов"). */
export function wordFor(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «3 670 файлов». */
export function filesCount(n: number): string {
  return `${groupDigits(n)} ${wordFor(n, "файл", "файла", "файлов")}`;
}

/** «1 240 из 3 670 файлов · 138 из 407 МБ». */
export function progressLine(view: Extract<UploadView, { phase: "uploading" }>): string {
  return `${groupDigits(view.doneFiles)} из ${filesCount(view.files)} · ${bytesOf(view.doneBytes, view.bytes)}`;
}

/** «2,4 МБ/с · осталось ≈ 3 мин»; пусто до первых замеров. */
export function paceLine(view: Extract<UploadView, { phase: "uploading" }>): string {
  return [speedText(view.speed), etaText(view.eta)].filter(Boolean).join(" · ");
}

/** «Пропущено 14 158 служебных: .venv, .git, __pycache__, по .gitignore…». */
export function skippedLine(view: Extract<UploadView, { phase: "confirm" }>, shown = 4): string {
  const names = view.groups.slice(0, shown).map(group => group.label).join(", ");
  const word = wordFor(view.skipped, "служебный", "служебных", "служебных");
  return `Пропущено ${view.skippedMore ? "не меньше " : ""}${groupDigits(view.skipped)} ${word}${names ? `: ${names}${view.groups.length > shown ? "…" : ""}` : ""}`;
}
