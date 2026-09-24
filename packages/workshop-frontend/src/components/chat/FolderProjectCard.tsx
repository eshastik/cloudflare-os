import { useCallback, useEffect, useRef, useState } from "react";
import { groupRefusals, refusedLine } from "../../../../gatekeeper-mnemos/src/upload-progress.ts";
import { FolderSimple, FolderSimpleStar } from "@phosphor-icons/react";
import type { ChatProjectChoice } from "@gadgets/workshop-shared/api";
import {
  FolderProjectNotConnected, createCodeProjectFromFolder, createProjectFromFolder, readDroppedFolder, retryProjectUpload,
  type DroppedFolder, type FolderProjectResult,
} from "../../folderProject";
import { MAX_UPLOAD_FILES } from "../../intakeDrop";
import { filesWord as countWord, megabytes, skippedFilesPhrase, skippedGroupsText } from "../../../../gatekeeper-mnemos/src/upload-filter.ts";

// Карточка «Создать проект «…» из N файлов?» над полем ввода: появляется, когда в беседу
// перетащили папку. Все шаги — словами, без технических терминов.

export type FolderProjectState =
  | { phase: "reading"; name: string }
  | { phase: "confirm"; folder: DroppedFolder }
  | { phase: "creating"; folder: DroppedFolder; done: number; total: number }
  | { phase: "done"; folder: DroppedFolder; result: FolderProjectResult }
  | { phase: "error"; folder?: DroppedFolder; message: string; offerPlain?: boolean };

type Creator = typeof createProjectFromFolder;
type Retrier = typeof retryProjectUpload;

function filesWord(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "файла";
  return "файлов";
}

function loadedWord(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "файл";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "файла";
  return "файлов";
}

// «Будет загружено 120 файлов (3,4 МБ). Пропущено 95 000 служебных файлов: node_modules, .venv».
export function folderSummary(folder: DroppedFolder): string | undefined {
  if (!folder.skipped) return undefined;
  const n = folder.files.length, bytes = folder.files.reduce((sum, { file }) => sum + file.size, 0);
  const m = folder.skipped.files;
  return `Будет загружено ${n} ${countWord(n)} (${megabytes(bytes)}). Пропущено ${folder.skipped.more ? "не меньше " : ""}${skippedFilesPhrase(m)}: ${skippedGroupsText(folder.skipped.groups)}.`;
}

export function folderQuestion(folder: DroppedFolder): string {
  const n = folder.files.length;
  return folder.hasCode
    ? `Создать проект с кодом «${folder.name}» из ${n} ${filesWord(n)}?`
    : `Создать проект «${folder.name}» из ${n} ${filesWord(n)}?`;
}

// Состояние карточки и действия. api — AuthenticatedApi оболочки; creators подменяются в тестах.
export function useFolderProject(
    api: Parameters<Creator>[0] | null,
    onCreated?: (project: ChatProjectChoice) => void,
    creators: { plain: Creator; code: Creator } = { plain: createProjectFromFolder, code: createCodeProjectFromFolder },
    retrier: Retrier = retryProjectUpload) {
  const [state, setState] = useState<FolderProjectState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const offer = useCallback((entry: FileSystemDirectoryEntry) => {
    setState({ phase: "reading", name: entry.name });
    readDroppedFolder(entry)
      .then(folder => setState(folder.files.length === 0
        ? { phase: "error", folder, message: `В папке «${folder.name}» нет файлов для загрузки.` }
        : { phase: "confirm", folder }))
      .catch((error: Error) => setState({ phase: "error", message: error?.message || "Не удалось прочитать папку." }));
  }, []);

  const create = useCallback(async (chosen: DroppedFolder, asCode: boolean, everything = false) => {
    if (!api) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let folder = chosen;
    setState({ phase: "creating", folder, done: 0, total: folder.files.length });
    try {
      // «Загрузить всё»: пропущенные файлы читаются только сейчас, по явному выбору.
      if (everything && chosen.skipped) {
        folder = { ...chosen, files: await chosen.skipped.all(), skipped: undefined };
        if (controller.signal.aborted) return;
        setState({ phase: "creating", folder, done: 0, total: folder.files.length });
      }
      const creator = asCode ? creators.code : creators.plain;
      const result = await creator(api, folder,
        (done, total) => { if (!controller.signal.aborted) setState({ phase: "creating", folder, done, total }); },
        controller.signal);
      if (controller.signal.aborted) return;
      setState({ phase: "done", folder, result });
      onCreated?.(result.project);
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        phase: "error", folder,
        message: (error as Error)?.message || "Не удалось создать проект.",
        offerPlain: error instanceof FolderProjectNotConnected,
      });
    }
  }, [api, creators, onCreated]);

  // Повтор только тех файлов, что не загрузились, — в тот же проект.
  const retry = useCallback(async (folder: DroppedFolder, previous: FolderProjectResult) => {
    if (!api) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const failed = new Set(previous.failed);
    const files = folder.files.filter(({ path }) => failed.has(path));
    setState({ phase: "creating", folder, done: 0, total: files.length });
    try {
      const again = await retrier(api, previous.project, files,
        (done, total) => { if (!controller.signal.aborted) setState({ phase: "creating", folder, done, total }); },
        controller.signal);
      if (controller.signal.aborted) return;
      setState({ phase: "done", folder, result: { ...previous, uploaded: previous.uploaded + again.uploaded, failed: again.failed, refused: [...previous.refused ?? [], ...again.refused ?? []] } });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ phase: "done", folder, result: previous });
      console.warn("Повтор загрузки не удался", error);
    }
  }, [api, retrier]);

  const dismiss = useCallback(() => { abortRef.current?.abort(); setState(null); }, []);

  return { state, offer, create, retry, dismiss };
}

const button = "flex h-[26px] cursor-pointer items-center rounded-md px-2 text-[12px] font-medium leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-kumo-ring disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-kumo-brand text-white hover:bg-kumo-brand-hover`;
const secondary = `${button} border border-kumo-line bg-kumo-base text-kumo-default hover:bg-kumo-tint`;

export function FolderProjectCard({ state, onCreate, onRetry, onDismiss }: {
  state: FolderProjectState;
  onCreate: (folder: DroppedFolder, asCode: boolean, everything?: boolean) => void;
  onRetry?: (folder: DroppedFolder, result: FolderProjectResult) => void;
  onDismiss: () => void;
}) {
  const code = "folder" in state && state.folder?.hasCode;
  let text: string;
  let note: string | undefined;
  let actions: React.ReactNode = null;
  switch (state.phase) {
    case "reading":
      text = `Читаю папку «${state.name}»…`;
      break;
    case "confirm": {
      const { folder } = state;
      const summary = folderSummary(folder);
      const everything = folder.skipped && !folder.skipped.more && folder.files.length + folder.skipped.files <= MAX_UPLOAD_FILES
        ? folder.files.length + folder.skipped.files : 0;
      if (folder.files.length > MAX_UPLOAD_FILES) {
        text = `В папке «${folder.name}» ${folder.files.length} файлов для загрузки — больше ${MAX_UPLOAD_FILES} за один раз.`;
        note = [summary, "Разделите папку на части и перетащите их по очереди."].filter(Boolean).join(" ");
        actions = <button type="button" className={secondary} onClick={onDismiss}>Закрыть</button>;
        break;
      }
      text = folderQuestion(folder);
      note = [summary, folder.hasCode
        ? "В папке есть код: проект получит своё хранилище кода."
        : "Файлы сразу лягут в новый проект; агент сможет с ними работать."].filter(Boolean).join(" ");
      actions = <>
        <button type="button" className={primary} onClick={() => onCreate(folder, folder.hasCode)}>Создать</button>
        <button type="button" className={secondary} onClick={onDismiss}>Отмена</button>
        {everything > 0 && <button type="button" className={`${button} text-kumo-subtle underline-offset-2 hover:underline`} onClick={() => onCreate(folder, folder.hasCode, true)}>Загрузить всё ({everything})</button>}
      </>;
      break;
    }
    case "creating":
      text = `Создаю проект «${state.folder.name}»: загружено ${state.done} из ${state.total}.`;
      actions = <button type="button" className={secondary} onClick={onDismiss}>Остановить</button>;
      break;
    case "done": {
      const { result } = state;
      text = `Проект «${result.project.title}» создан, загружено ${result.uploaded} ${loadedWord(result.uploaded)}.`;
      const paths = new Set(state.folder.files.map(({ path }) => path));
      const retryable = !!onRetry && result.failed.length > 0 && result.failed.every(path => paths.has(path));
      const refused = result.refused?.length ? `${refusedLine(groupRefusals(result.refused))}.` : "";
      if (result.failed.length) {
        note = [`Не загрузилось ${result.failed.length} ${countWord(result.failed.length)}: ${result.failed.slice(0, 3).join(", ")}${result.failed.length > 3 ? "…" : ""}`, refused].filter(Boolean).join(" ");
      } else {
        note = [refused, "Проект подключён к беседе."].filter(Boolean).join(" ");
      }
      actions = <>
        {retryable && <button type="button" className={primary} onClick={() => onRetry!(state.folder, result)}>Повторить</button>}
        <button type="button" className={secondary} onClick={onDismiss}>Закрыть</button>
      </>;
      break;
    }
    case "error":
      text = state.message;
      actions = <>
        {state.offerPlain && state.folder && (
          <button type="button" className={primary} onClick={() => onCreate(state.folder!, false)}>Создать как обычный проект</button>
        )}
        <button type="button" className={secondary} onClick={onDismiss}>{state.offerPlain ? "Отмена" : "Закрыть"}</button>
      </>;
      break;
  }
  return (
    <div role="status" aria-label="Проект из папки" className="mb-2 flex items-start gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-kumo-line bg-kumo-elevated text-kumo-subtle" aria-hidden="true">
        {code ? <FolderSimpleStar size={18} /> : <FolderSimple size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] leading-[18px] font-medium tracking-[-0.25px] [overflow-wrap:anywhere] ${state.phase === "error" ? "text-kumo-danger" : "text-kumo-default"}`}>{text}</div>
        {note && <div className="mt-0.5 text-[12px] leading-4 text-kumo-subtle [overflow-wrap:anywhere]">{note}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
