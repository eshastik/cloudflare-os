// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { newMessagePortRpcSession, RpcStub, RpcTarget } from "capnweb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatekeeperUiFrame } from "@gadgets/workshop-shared/gatekeeper";
import SandboxedGatekeeperApp from "./SandboxedGatekeeperApp";
import UploadDock from "./UploadDock";
import { installPageHooks, uploadCenter, UploadCenter, type UploadApi } from "./uploadCenter";
import type { IntakeDroppedFile } from "./intakeDrop";

vi.mock("./ThemeContext", () => ({ useTheme: () => ({ resolvedThemeMode: "light" }) }));
vi.mock("./errorReporting", () => ({ forwardTrustedFrameError: () => false }));
vi.mock("./AuthContext", () => {
  const authenticatedApi = { listGadgets: async () => [] };
  return { useAuthenticatedApi: () => ({ authenticatedApi }), useOptionalAuthenticatedApi: () => null };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class EmptyUi extends RpcTarget {}

/** Хранилище приёмной: билеты на любой файл, подтверждения записываются по пути. */
class Issuer extends RpcTarget {
  submitted: string[] = [];
  projects: (string | undefined)[] = [];
  issue(size: number, checksum: string, project?: string) {
    this.projects.push(project);
    return { upload_id: String(this.projects.length), url: "https://storage.example/file", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size };
  }
  submit(_id: string, path: string) { this.submitted.push(path); return { outcome: "enqueued", enqueued: true }; }
}

/** PUT файлов с именем из held висит, пока тест не отпустит его. */
function heldFetch(held: Set<string>) {
  const waiting = new Map<string, () => void>();
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const name = (init.body as File).name;
    if (!held.has(name)) return new Response(null, { status: 200 });
    return new Promise<Response>((resolve, reject) => {
      waiting.set(name, () => resolve(new Response(null, { status: 200 })));
      (init.signal as AbortSignal).addEventListener("abort", () => reject(Error("abort")), { once: true });
    });
  });
  return { fetch, waiting, release: (name: string) => { held.delete(name); waiting.get(name)?.(); waiting.delete(name); } };
}

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() { return this.#items.size; }
  clear() { this.#items.clear(); }
  getItem(key: string) { return this.#items.get(key) ?? null; }
  key(index: number) { return [...this.#items.keys()][index] ?? null; }
  removeItem(key: string) { this.#items.delete(key); }
  setItem(key: string, value: string) { this.#items.set(key, value); }
}

let RealFile: typeof File;
beforeEach(async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
  RealFile = (await vi.importActual<{ File: typeof File }>("node:buffer")).File;
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("File", RealFile);
});
afterEach(() => { uploadCenter.abortAll(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const file = (name: string, text = "x") => new RealFile([text], name) as unknown as File;

describe("загрузка на уровне оболочки", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); window.history.replaceState(null, "", "/"); });

  it("уход из Mnemos в беседу и обратно не останавливает очередь; закрытие фрейма загрузку не прерывает", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const issuer = new Issuer();
    const net = heldFetch(new Set(["смета.txt"]));
    vi.stubGlobal("fetch", net.fetch);
    const frame = { iframeHtml: "<!doctype html><title>Mnemos</title>", ui: new RpcStub(new EmptyUi()), inboxUploads: { storageOrigin: "https://storage.example", issuer: new RpcStub(issuer) } } as unknown as GatekeeperUiFrame;
    const rootRoute = createRootRoute({ component: () => <><Outlet /><UploadDock /></> });
    const chat = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Беседа</p> });
    const app = createRoute({ getParentRoute: () => rootRoute, path: "/gatekeepers/$appId", component: () => <SandboxedGatekeeperApp frame={frame} gatekeeperVendorId="mnemos" accountId={7} /> });
    const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/gatekeepers/mnemos"] }), routeTree: rootRoute.addChildren([chat, app]) });
    window.history.replaceState(null, "", "/?section=projects&project=p1");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<RouterProvider router={router} />));
    type View = { phase: string; id: number; [key: string]: unknown } | null;
    class Receiver extends RpcTarget { views: View[] = []; setUploadState(view: View) { this.views.push(view); } }
    const connect = () => {
      const { port1, port2 } = new MessageChannel();
      const host = newMessagePortRpcSession<RpcTarget & { subscribeUploads(r: Receiver): Promise<View> }>(port1, new Receiver());
      window.dispatchEvent(new MessageEvent("message", { data: { type: "handshake" }, origin: "null", source: container!.querySelector("iframe")!.contentWindow, ports: [port2] }));
      return host;
    };
    const dock = () => container!.querySelector('[data-testid="upload-dock"]');
    const until = (check: () => void) => vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); check(); }, { timeout: 3000 });
    const drop = async (names: string[]) => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files: names.map(name => file(name)), items: [] } });
      const drag = new Event("dragenter", { bubbles: true }); Object.defineProperty(drag, "dataTransfer", { value: { types: ["Files"] } });
      await act(async () => { window.dispatchEvent(drag); });
      await act(async () => { container!.querySelector('[data-testid="intake-drop-layer"]')!.dispatchEvent(event); });
    };

    const host = connect();
    // Фрейм рисует уведомление сам — плашка оболочки скрыта.
    expect(await host.subscribeUploads(new Receiver())).toBeNull();
    await drop(["договор.txt", "смета.txt"]);
    await until(() => expect(issuer.submitted).toEqual(["договор.txt"]));
    expect(dock()).toBeNull();
    // Вторая загрузка, пока идёт первая, встаёт в очередь.
    await drop(["счёт.txt"]);
    await until(() => expect(uploadCenter.view()).toMatchObject({ phase: "uploading", queued: 1 }));

    // Уход в беседу: фрейм уничтожен, загрузка идёт, плашка оболочки показывает ход и очередь.
    await act(async () => { await router.navigate({ to: "/" }); });
    expect(container.querySelector("iframe")).toBeNull();
    await until(() => expect(dock()?.textContent).toContain("ещё 1 в очереди"));
    expect(dock()!.textContent).toContain("Загружаем");
    expect(net.fetch.mock.calls.every(([, init]) => !(init.signal as AbortSignal).aborted)).toBe(true);

    net.release("смета.txt");
    await until(() => expect(issuer.submitted).toEqual(["договор.txt", "смета.txt", "счёт.txt"]));
    expect(issuer.projects).toEqual(["p1", "p1", "p1"]);
    await until(() => expect(dock()?.textContent).toContain("Загружено 1 файл"));

    // Щелчок по плашке ведёт к проекту; новый фрейм подписывается и видит итог, плашка скрывается.
    await act(async () => { ([...dock()!.querySelectorAll("button")].find(b => /открыть проект/i.test(b.textContent ?? "")) as HTMLButtonElement).click(); });
    await until(() => expect(router.state.location.search).toMatchObject({ section: "projects", project: "p1", account: 7 }));
    const again = connect();
    expect(await again.subscribeUploads(new Receiver())).toMatchObject({ phase: "done", accepted: 1 });
    await until(() => expect(dock()).toBeNull());
    host[Symbol.dispose](); again[Symbol.dispose]();
  });
});

describe("владелец загрузок", () => {
  const api = (issuer: Issuer): UploadApi & { frames: number } => {
    const bridge = {
      frames: 0,
      async getGatekeeperApp(id: string, accountId?: number) {
        expect([id, accountId]).toEqual(["mnemos", 7]);
        bridge.frames++;
        return { iframeHtml: "", ui: new RpcStub(new EmptyUi()), inboxUploads: { storageOrigin: "https://storage.example", issuer: new RpcStub(issuer) } } as unknown as GatekeeperUiFrame;
      },
    };
    return bridge;
  };
  const plan = (files: IntakeDroppedFile[]) => async () => ({ files, bytes: files.reduce((sum, { file }) => sum + file.size, 0), skippedFiles: 0, skippedMore: false, groups: [], skippedDirs: [], allFiles: async () => files });

  it("предупреждение beforeunload стоит только пока файлы отправляются", async () => {
    const issuer = new Issuer();
    const net = heldFetch(new Set(["один.txt"]));
    vi.stubGlobal("fetch", net.fetch);
    const center = new UploadCenter({ storage: () => null });
    const page = new EventTarget() as unknown as Window;
    const uninstall = installPageHooks(center, page);
    const leave = () => { const event = new Event("beforeunload", { cancelable: true }); page.dispatchEvent(event); return event.defaultPrevented; };
    center.bind(api(issuer), "u1");
    expect(leave()).toBe(false);
    const done = center.start({ target: { vendorId: "mnemos", accountId: 7, project: "p1" }, directory: false, note: "", plan: plan([{ file: file("один.txt"), path: "один.txt" }]) });
    await vi.waitFor(() => expect(net.waiting.size).toBe(1));
    expect(leave()).toBe(true);
    net.release("один.txt");
    await done;
    expect(issuer.submitted).toEqual(["один.txt"]);
    expect(leave()).toBe(false);
    uninstall();
  });

  it("после перезагрузки вкладки: «прервано», выбор папки заново пропускает принятое по пути и SHA-256", async () => {
    const storage = new MemoryStorage();
    const before = new Issuer();
    const net = heldFetch(new Set(["третий.txt"]));
    vi.stubGlobal("fetch", net.fetch);
    const tab = new UploadCenter({ storage: () => storage });
    tab.bind(api(before), "u1");
    const picked = () => [["Отчёты/первый.txt", "один"], ["Отчёты/второй.txt", "два"], ["Отчёты/третий.txt", "три"]]
      .map(([path, text]) => ({ path, file: Object.defineProperty(file(path.split("/")[1], text), "webkitRelativePath", { value: path }) }));
    void tab.start({ target: { vendorId: "mnemos", accountId: 7, project: "p1" }, directory: true, note: "", plan: plan(picked()) }).catch(() => {});
    await vi.waitFor(() => expect(before.submitted).toEqual(expect.arrayContaining(["Отчёты/первый.txt", "Отчёты/второй.txt"])));
    await vi.waitFor(() => expect(net.waiting.size).toBe(1));
    // Вкладку закрывают посреди загрузки.
    tab.pageHidden();
    tab.abortAll();

    const after = new Issuer();
    const bridge = api(after);
    const pick = vi.fn(async (directory: boolean) => { expect(directory).toBe(true); return picked(); });
    const reloaded = new UploadCenter({ storage: () => storage, pick });
    reloaded.bind(bridge, "u1");
    const { job } = reloaded.snapshot();
    expect(job?.state).toMatchObject({ phase: "done", interrupted: true, files: 3, accepted: 2, stopped: 1, project: "p1" });
    expect(job?.folder).toBe("Отчёты");
    expect(reloaded.view()).toMatchObject({ phase: "done", interrupted: true, stopped: 1 });
    // Другой человек в той же вкладке чужих записей не видит.
    const other = new UploadCenter({ storage: () => storage });
    other.bind(bridge, "u2");
    expect(other.snapshot().job).toBeNull();

    net.release("третий.txt");
    reloaded.resume(job!.id);
    await vi.waitFor(() => expect(reloaded.snapshot().job?.state).toMatchObject({ phase: "done", files: 3, accepted: 3, stopped: 0 }));
    expect(after.submitted).toEqual(["Отчёты/третий.txt"]);
    // Загрузка шла без открытого фрейма: билет выдан через новый кадр того же подключения.
    expect(bridge.frames).toBe(1);
    expect(reloaded.snapshot().job?.state).not.toHaveProperty("interrupted", true);
    expect(storage.length).toBe(0);
  });
});
