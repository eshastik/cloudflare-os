// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
// Проект из папки, перетащенной в беседу.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FolderProjectNotConnected, createCodeProjectFromFolder, createProjectFromFolder, droppedFolderEntry,
  looksLikeCodeFolder, projectSlug, readDroppedFolder, uploadableFiles, type DroppedFolder,
} from "./folderProject";
import { FolderProjectCard, folderQuestion, useFolderProject } from "./components/chat/FolderProjectCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (value: File) => ({ name: value.name, isFile: true, isDirectory: false, file: (done: (f: File) => void) => done(value) });
const directory = (name: string, children: unknown[]) => ({
  name, isFile: false, isDirectory: true,
  createReader: () => { let read = false; return { readEntries: (done: (items: unknown[]) => void) => { done(read ? [] : children); read = true; } }; },
});
// В jsdom у File нет arrayBuffer(); загрузка считает по нему контрольную сумму.
const bytesFile = (name: string) => Object.assign(new File(["x"], name), { arrayBuffer: async () => new Uint8Array([120]).buffer });
const at = (path: string) => ({ file: bytesFile(path.split("/").pop()!), path });

describe("что лежит в папке", () => {
  it("папка с .git, файлом сборки или заметной долей исходников — это код", () => {
    expect(looksLikeCodeFolder(["Сайт/.git/HEAD", "Сайт/readme.md"])).toBe(true);
    expect(looksLikeCodeFolder(["Сервис/go.mod", "Сервис/Отчёт.docx"])).toBe(true);
    expect(looksLikeCodeFolder(["А/a.ts", "А/b.ts", "А/c.tsx", "А/d.md"])).toBe(true);
    expect(looksLikeCodeFolder(["Отчёты/итоги.docx", "Отчёты/смета.xlsx", "Отчёты/скрипт.py"])).toBe(false);
    expect(looksLikeCodeFolder(["Отчёты/вложено/package.json"])).toBe(false);
  });

  it("служебное содержимое .git и системный мусор не загружаются", () => {
    const files = uploadableFiles([at("Сайт/.git/HEAD"), at("Сайт/.DS_Store"), at("Сайт/src/app.ts"), at("Сайт/README.md")]);
    expect(files.map(f => f.path)).toEqual(["Сайт/src/app.ts", "Сайт/README.md"]);
  });

  it("краткое имя проекта — латиницей, из русского названия", () => {
    expect(projectSlug("Отчёты 2026")).toBe("otchety-2026");
    expect(projectSlug("Щука & Ёж")).toBe("schuka-ezh");
    expect(projectSlug("!!!")).toBe("proekt");
  });

  it("проектом становится только одна перетащенная папка; файлы остаются вложениями", async () => {
    const folder = directory("Отчёты 2026", [file(new File(["a"], "итог.docx")), directory("архив", [file(new File(["b"], "старый.pdf"))])]);
    const one = { items: [{ kind: "file", webkitGetAsEntry: () => folder }] } as unknown as DataTransfer;
    const entry = droppedFolderEntry(one)!;
    expect(entry.name).toBe("Отчёты 2026");
    const read = await readDroppedFolder(entry);
    expect(read).toMatchObject({ name: "Отчёты 2026", hasCode: false });
    expect(read.files.map(f => f.path)).toEqual(["Отчёты 2026/итог.docx", "Отчёты 2026/архив/старый.pdf"]);

    const files = { items: [{ kind: "file", webkitGetAsEntry: () => file(new File(["a"], "a.txt")) }] } as unknown as DataTransfer;
    expect(droppedFolderEntry(files)).toBeNull();
    const two = { items: [{ kind: "file", webkitGetAsEntry: () => folder }, { kind: "file", webkitGetAsEntry: () => folder }] } as unknown as DataTransfer;
    expect(droppedFolderEntry(two)).toBeNull();
  });
});

describe("создание проекта существующими методами приложения", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeApi(createProject: (name: string, slug: string) => Promise<unknown>) {
    const issued: unknown[][] = [], submitted: unknown[][] = [];
    const frame = {
      iframeHtml: "", ui: { createProject, [Symbol.dispose]: vi.fn() },
      inboxUploads: {
        storageOrigin: "https://storage.example",
        issuer: {
          issue: async (size: number, checksum: string, project?: string) => {
            issued.push([size, project]);
            return { upload_id: `u${issued.length}`, url: "https://storage.example/put", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size };
          },
          submit: async (...args: unknown[]) => { submitted.push(args); return { outcome: "accepted", enqueued: true }; },
          [Symbol.dispose]: vi.fn(),
        },
      },
    };
    const api = {
      subscribeConnectedAccounts: async (s: { add: (...a: unknown[]) => void; ready: () => void }) => {
        s.add(7, { displayName: "Mnemos", avatar: { url: "" }, providesUi: { title: "Mnemos" } }, { displayName: "Mnemos", url: "https://m.example" }, [], true, "mnemos");
        s.ready();
        return { [Symbol.dispose]() {} };
      },
      getGatekeeperApp: vi.fn(async () => frame),
    };
    return { api: api as never, issued, submitted, frame };
  }

  it("создаёт проект, загружает каждый файл в него и отдаёт проект для чипа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const createProject = vi.fn(async (name: string, _slug: string) => ({ project: { id: "p1", name } }));
    const { api, issued, submitted, frame } = fakeApi(createProject);
    const folder: DroppedFolder = { name: "Отчёты 2026", files: [at("Отчёты 2026/итог.txt"), at("Отчёты 2026/смета.txt")], hasCode: false };
    const progress: number[] = [];
    const result = await createProjectFromFolder(api, folder, done => progress.push(done));
    expect(createProject).toHaveBeenCalledWith("Отчёты 2026", "otchety-2026");
    expect(issued.map(i => i[1])).toEqual(["p1", "p1"]);
    expect(submitted.map(s => [s[1], s[3]])).toEqual([["Отчёты 2026/итог.txt", "p1"], ["Отчёты 2026/смета.txt", "p1"]]);
    expect(progress).toEqual([1, 2]);
    expect(result).toEqual({ project: { accountId: 7, projectId: "p1", title: "Отчёты 2026", hasCode: false }, uploaded: 2, failed: [] });
    expect(frame.ui[Symbol.dispose]).toHaveBeenCalled();
  });

  it("занятое имя — следующий номер; отказ в правах — понятная ошибка", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const busy = vi.fn(async (name: string, slug: string) => {
      if (slug === "otchety") throw new Error("409 conflict");
      return { project: { id: "p2", name } };
    });
    const folder: DroppedFolder = { name: "Отчёты", files: [], hasCode: false };
    expect((await createProjectFromFolder(fakeApi(busy).api, folder)).project.projectId).toBe("p2");
    expect(busy.mock.calls.map(c => c[1])).toEqual(["otchety", "otchety-2"]);

    const denied = vi.fn(async () => { throw new Error("403 forbidden"); });
    await expect(createProjectFromFolder(fakeApi(denied).api, folder)).rejects.toThrow("Не удалось создать проект «Отчёты»: нет права создавать проекты.");
  });

  it("проект с кодом пока не подключён — заглушка с понятной ошибкой", async () => {
    const folder: DroppedFolder = { name: "Сайт", files: [at("Сайт/app.ts")], hasCode: true };
    const error = await createCodeProjectFromFolder(null as never, folder).catch(e => e);
    expect(error).toBeInstanceOf(FolderProjectNotConnected);
    expect(error.message).toContain("ещё не подключён");
  });
});

describe("карточка «Создать проект из папки»", () => {
  let root: Root | null = null, container: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

  it("вопрос с числом файлов и пометкой о коде", () => {
    expect(folderQuestion({ name: "Отчёты 2026", files: Array(48).fill(at("a/b")), hasCode: false })).toBe("Создать проект «Отчёты 2026» из 48 файлов?");
    expect(folderQuestion({ name: "Отчёт", files: [at("a/b")], hasCode: false })).toBe("Создать проект «Отчёт» из 1 файла?");
    expect(folderQuestion({ name: "Сайт", files: Array(21).fill(at("a/b")), hasCode: true })).toBe("Создать проект с кодом «Сайт» из 21 файла?");
  });

  it("перетащили папку → вопрос → «Создать» → проект создан и передан беседе", async () => {
    const created = vi.fn();
    const plain = vi.fn(async (_api: unknown, folder: DroppedFolder, onProgress?: (d: number, t: number) => void) => {
      onProgress?.(1, 1);
      return { project: { accountId: 7, projectId: "p1", title: folder.name, hasCode: false }, uploaded: 1, failed: [] };
    });
    const code = vi.fn(async () => { throw new FolderProjectNotConnected("Проект с кодом из папки ещё не подключён."); });
    let hook!: ReturnType<typeof useFolderProject>;
    const creators = { plain, code } as never;
    function Harness() {
      hook = useFolderProject({} as never, created, creators);
      return hook.state ? <FolderProjectCard state={hook.state} onCreate={hook.create} onDismiss={hook.dismiss} /> : null;
    }
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    const entry = directory("Отчёты", [file(new File(["a"], "итог.docx"))]);
    await act(async () => hook.offer(entry as unknown as FileSystemDirectoryEntry));
    expect(container.textContent).toContain("Создать проект «Отчёты» из 1 файла?");
    const button = (text: string) => [...container!.querySelectorAll("button")].find(b => b.textContent === text)!;
    await act(async () => button("Создать").click());
    expect(plain).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledWith({ accountId: 7, projectId: "p1", title: "Отчёты", hasCode: false });
    expect(container.textContent).toContain("Проект «Отчёты» создан, загружено 1 файл.");
    await act(async () => button("Закрыть").click());
    expect(container.textContent).toBe("");
  });

  it("папка с кодом: заглушка → предложение создать обычный проект", async () => {
    const plain = vi.fn(async (_api: unknown, folder: DroppedFolder) => ({ project: { accountId: 7, projectId: "p9", title: folder.name, hasCode: false }, uploaded: 2, failed: [] }));
    const code = vi.fn(async () => { throw new FolderProjectNotConnected("Проект с кодом из папки ещё не подключён."); });
    let hook!: ReturnType<typeof useFolderProject>;
    const creators = { plain, code } as never;
    function Harness() {
      hook = useFolderProject({} as never, undefined, creators);
      return hook.state ? <FolderProjectCard state={hook.state} onCreate={hook.create} onDismiss={hook.dismiss} /> : null;
    }
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    const entry = directory("Сайт", [directory(".git", [file(new File(["h"], "HEAD"))]), file(new File(["a"], "app.ts")), file(new File(["b"], "index.ts"))]);
    await act(async () => hook.offer(entry as unknown as FileSystemDirectoryEntry));
    expect(container.textContent).toContain("Создать проект с кодом «Сайт» из 2 файлов?");
    const button = (text: string) => [...container!.querySelectorAll("button")].find(b => b.textContent === text)!;
    await act(async () => button("Создать").click());
    expect(code).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("ещё не подключён");
    await act(async () => button("Создать как обычный проект").click());
    expect(plain).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Проект «Сайт» создан, загружено 2 файла.");
  });

  it("пустая папка — сообщение без кнопки «Создать»", async () => {
    let hook!: ReturnType<typeof useFolderProject>;
    function Harness() {
      hook = useFolderProject({} as never);
      return hook.state ? <FolderProjectCard state={hook.state} onCreate={hook.create} onDismiss={hook.dismiss} /> : null;
    }
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    await act(async () => hook.offer(directory("Пусто", []) as unknown as FileSystemDirectoryEntry));
    expect(container.textContent).toContain("В папке «Пусто» нет файлов для загрузки.");
    expect([...container.querySelectorAll("button")].some(b => b.textContent === "Создать")).toBe(false);
  });
});
