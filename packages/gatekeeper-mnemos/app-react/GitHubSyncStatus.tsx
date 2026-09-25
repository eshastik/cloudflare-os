import { useEffect, useState } from "react";
import { CaretDown, Code, HardDrives } from "@phosphor-icons/react";
import type { CodeFromFilesResult, RepositoryRecord } from "../src/git-repositories.ts";
import { useUi } from "./host.ts";
import { useLoad } from "./data.ts";
import { Pill, plural } from "./admin-ui.tsx";
import { Notice } from "./ui.tsx";
import { relativeTime } from "./time.ts";

/** «Файлы: …» на странице проекта теми же словами, что в разделе «Репозитории». */
export function recordFilesText(r: RepositoryRecord, now = Date.now()): { text: string; attention: boolean; busy: boolean } {
  const l = r.link;
  if (r.provider !== "github") return { text: "код во внутреннем хранилище", attention: false, busy: false };
  if (!l) return { text: "выключены", attention: false, busy: false };
  if (l.access_revoked) return { text: "доступ отозван в GitHub, файлы остались", attention: true, busy: false };
  if (l.paused) return { text: "выключены, файлы остались", attention: false, busy: false };
  const count = `${l.file_count ?? 0} ${plural(l.file_count ?? 0, "файл", "файла", "файлов")}`;
  switch (l.state) {
    case "ok": return { text: `синхронизировано ${l.last_synced_at ? relativeTime(l.last_synced_at, now) : "только что"} · ${count}`, attention: false, busy: false };
    case "pending": case "syncing": return { text: (l.file_count ?? 0) > 0 ? `идёт синхронизация · уже ${count}` : "идёт первая загрузка", attention: false, busy: true };
    case "conflict": return { text: "конфликт: файл изменён и в Mnemos, и в GitHub", attention: true, busy: false };
    default: return { text: l.message || "обновление не прошло", attention: true, busy: false };
  }
}

/** Страница проекта: «Репозиторий: … · Файлы: … · Агенты кода: …» — тем же языком, что раздел «Репозитории».
 * Пока идёт загрузка файлов, состояние перечитывается само. */
export default function GitHubSyncStatus({ projectId, fileCount = 0, moreFiles = false, canEdit = false, onCodeConnected }: { projectId: string; fileCount?: number; moreFiles?: boolean; canEdit?: boolean; onCodeConnected?(): void }) {
  const ui = useUi();
  const records = useLoad(async () => (await ui.listProjectRepositories(projectId)).records, "", [ui, projectId]);
  const list = records.value ?? [];
  const [connected, setConnected] = useState<NonNullable<CodeFromFilesResult["repository"]> | null>(null);
  const busy = list.some(r => recordFilesText(r).busy);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void records.reload(), 4000);
    return () => clearInterval(timer);
  }, [busy, records.reload]);
  const done = connected && <ConnectedCode result={connected} />;
  if (!list.length) {
    // Файлы уже загружены, а кода у проекта нет — его можно подключить из этих файлов прямо здесь.
    if (records.loading || records.error || fileCount === 0 || !canEdit) return null;
    return <ConnectInternalCode projectId={projectId} fileCount={fileCount} moreFiles={moreFiles} onConnected={result => { setConnected(result); void records.reload(); onCodeConnected?.(); }} />;
  }
  return <div aria-label="Репозитории проекта" className="mb-5 grid gap-1.5">
    {done}
    {list.map(r => {
      const files = recordFilesText(r);
      return <p key={`${r.connection_id}/${r.repository_id}`} role="status" data-project-repository="" className={`m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] ${files.attention ? "text-kumo-warning" : "text-kumo-subtle"}`}>
        <Code size={15} aria-hidden="true" className="shrink-0" />
        <span>Репозиторий: <span className="text-kumo-default">{r.repository_name}</span></span>
        <span>· Файлы: {files.text}</span>
        <span className={r.agents_access_revoked ? "text-kumo-warning" : ""}>· Агенты кода: {!r.agents ? "выключены" : r.agents_access_revoked ? "доступ отозван в GitHub" : "включены"}</span>
        {files.busy && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-kumo-warning motion-reduce:animate-none" />}
      </p>;
    })}
  </div>;
}

function filesWord(n: number): string { return `${n} ${plural(n, "файл", "файла", "файлов")}`; }

/** «Подключить внутреннее хранилище кода»: проект с уже загруженными файлами получает репозиторий во
 * внутреннем хранилище Mnemos одним нажатием. Кнопка видна человеку всегда, когда кода нет, — не только
 * после того, как агент беседы упёрся в «У проекта нет подключённого кода». */
function ConnectInternalCode({ projectId, fileCount, moreFiles, onConnected }: { projectId: string; fileCount: number; moreFiles: boolean; onConnected(result: NonNullable<CodeFromFilesResult["repository"]>): void }) {
  const ui = useUi();
  const hosting = useLoad(async () => (await ui.listRepositoryOverview()).internal.available, "", [ui]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!hosting.value) return null;
  async function connect() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const out = await ui.connectCodeFromFiles(projectId);
      if (out.repository) onConnected(out.repository);
      else setError(out.reason ?? "Код не подключён.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(/[а-яё]/i.test(message) ? message : "Код не подключён. Подключить может тот, кто вправе править проект; обновите страницу и повторите.");
    } finally { setBusy(false); }
  }
  return <section aria-label="Код проекта" data-connect-code="" className="mb-5 grid gap-3 rounded-2xl border border-kumo-fill bg-kumo-overlay px-4 py-3.5 sm:px-5">
    <div className="flex flex-wrap items-start gap-3">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-kumo-tint text-kumo-default"><HardDrives size={18} /></span>
      <span className="block min-w-[200px] flex-1">
        <span className="block text-[15px] font-medium text-kumo-default">Код проекта не подключён</span>
        <span className="block max-w-[640px] text-[13px] leading-[19px] text-kumo-subtle">В проекте {moreFiles ? `больше ${filesWord(fileCount)}` : filesWord(fileCount)}. Их можно положить во внутреннее хранилище кода Mnemos: первая версия — из текущих файлов, дальше агенты кода работают в своих ветках, а вы забираете и отправляете изменения через git как обычно. Файлы в проекте остаются на месте.</span>
      </span>
      <Pill tone="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void connect()}>{busy ? "Кладём файлы в хранилище…" : "Подключить внутреннее хранилище кода"}</Pill>
    </div>
    {busy && <p role="status" className="m-0 text-[13px] text-kumo-subtle sm:pl-12">Большой проект кладётся несколькими частями — это может занять пару минут.</p>}
    {error && <div className="sm:pl-12"><Notice tone="danger">{error}</Notice></div>}
  </section>;
}

/** Итог подключения: сколько файлов легло, что пропущено и почему. */
function ConnectedCode({ result }: { result: NonNullable<CodeFromFilesResult["repository"]> }) {
  const [open, setOpen] = useState(false);
  const large = result.skipped.filter(s => s.reason === "large").length, service = result.skipped.filter(s => s.reason === "path").length;
  const parts = [service ? `служебные папки ${service}` : "", large ? `больше 4 МБ ${large}` : ""].filter(Boolean).join(", ");
  return <div role="status" data-code-connected="" className="grid gap-1 text-[13px] text-kumo-brand">
    <span>Код подключён: {filesWord(result.files)} в репозитории {result.repository_name}{result.commits > 1 ? ` (${result.commits} ${plural(result.commits, "коммит", "коммита", "коммитов")})` : ""}. Агенты кода включены.</span>
    {result.skipped_count > 0 && <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex w-fit items-center gap-1 border-0 bg-transparent p-0 text-[13px] text-kumo-subtle hover:underline">
      Не перенесено {result.skipped_count}{parts ? ` (${parts})` : ""}<CaretDown size={11} aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} />
    </button>}
    {open && <ul aria-label="Не перенесённые файлы" className="m-0 grid max-h-[180px] max-w-[560px] list-none gap-0.5 overflow-y-auto rounded-lg border border-kumo-fill bg-kumo-overlay p-2">
      {result.skipped.map(s => <li key={s.path} className="flex gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate font-mono text-kumo-default">{s.path}</span><span className="shrink-0 text-kumo-subtle">{s.reason === "large" ? "больше 4 МБ" : "служебная папка"}</span></li>)}
    </ul>}
  </div>;
}
