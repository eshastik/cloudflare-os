// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_CLOSE_MS, runIntakeUpload, toUploadView, useIntakeUploadPanel, type IntakeUploadPanelState, type IntakeUploadUi } from "./intakeUploadPanel";
import type { IntakeDroppedFile, IntakeUploadPlan } from "./intakeDrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (path: string, size: number): IntakeDroppedFile => ({ path, file: { size, name: path.split("/").pop() } as File });
const plan = (files: IntakeDroppedFile[]): IntakeUploadPlan => ({
  files, bytes: files.reduce((sum, f) => sum + f.file.size, 0), skippedFiles: 0, skippedMore: false, groups: [], skippedDirs: [], allFiles: async () => files,
});

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; vi.useRealTimers(); });

function mount(): { ui: IntakeUploadUi; state(): IntakeUploadPanelState | null } {
  let panel: ReturnType<typeof useIntakeUploadPanel> | null = null;
  function Probe() { panel = useIntakeUploadPanel(); return null; }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe />));
  return { ui: panel!.ui, state: () => panel!.current() };
}

describe("уведомление о загрузке в оболочке", () => {
  it("ход считается по байтам и обновляется не чаще раза в 200 мс; скорость и остаток сглажены", () => {
    vi.useFakeTimers({ now: 0 });
    const { ui, state } = mount();
    act(() => { ui.reading("p1"); ui.start([file("Лев/a", 100), file("Лев/b", 300)], () => {}); });
    act(() => { vi.setSystemTime(1000); ui.progress({ doneFiles: 1, doneBytes: 100, failed: 0, current: "Лев/b" }); });
    // Второе обновление в пределах 200 мс не рисуется сразу, а приходит последним значением.
    act(() => { ui.progress({ doneFiles: 1, doneBytes: 150, failed: 0, current: "Лев/b" }); });
    expect((state() as Extract<IntakeUploadPanelState, { phase: "uploading" }>).progress.doneBytes).toBe(0);
    act(() => { vi.advanceTimersByTime(200); });
    const view = toUploadView(state());
    expect(view).toMatchObject({ phase: "uploading", project: "p1", files: 2, bytes: 400, doneFiles: 1, doneBytes: 150, current: "Лев/b" });
    expect((view as { speed: number }).speed).toBeGreaterThan(0);
  });

  it("итог без ошибок закрывается сам, с ошибками — остаётся", () => {
    vi.useFakeTimers({ now: 0 });
    const { ui, state } = mount();
    const done = { files: 2, accepted: 2, acceptedBytes: 10, failed: [] as string[], refused: [], stopped: 0, personal: false, note: "", retry: null, resume: null };
    act(() => { ui.reading("p1"); ui.done(done); });
    act(() => { vi.advanceTimersByTime(AUTO_CLOSE_MS - 1); });
    expect(state()?.phase).toBe("done");
    act(() => { vi.advanceTimersByTime(1); });
    expect(state()).toBeNull();
    act(() => { ui.reading("p1"); ui.done({ ...done, accepted: 1, failed: ["Лев/b"] }); });
    act(() => { vi.advanceTimersByTime(AUTO_CLOSE_MS * 2); });
    expect(state()?.phase).toBe("done");
  });

  it("повтор берёт только не принятые файлы и складывает итог", async () => {
    const { ui, state } = mount();
    const files = [file("Лев/a", 100), file("Лев/b", 200), file("Лев/c", 300)];
    const runs: string[][] = [];
    let first = true;
    const upload = vi.fn(async (list: IntakeDroppedFile[]) => {
      runs.push(list.map(f => f.path));
      const results = list.map(({ path }) => (first && path === "Лев/b" ? { path, error: "сбой" } : { path, uploadId: "u" }));
      first = false;
      return results;
    });
    const afterRun = vi.fn();
    await act(async () => { ui.reading("p1"); await runIntakeUpload(ui, plan(files), upload, "готово", afterRun); });
    expect(toUploadView(state())).toMatchObject({ phase: "done", files: 3, accepted: 2, acceptedBytes: 400, failed: ["Лев/b"], failedCount: 1, stopped: 0 });
    await act(async () => { (state() as Extract<IntakeUploadPanelState, { phase: "done" }>).retry!(); await vi.waitFor(() => expect(afterRun).toHaveBeenCalled()); });
    expect(runs).toEqual([["Лев/a", "Лев/b", "Лев/c"], ["Лев/b"]]);
    expect(toUploadView(state())).toMatchObject({ phase: "done", accepted: 3, acceptedBytes: 600, failedCount: 0 });
  });

  it("отказ по правилу установки — не ошибка: без повтора, с причиной и группировкой, итог не закрывается сам", async () => {
    vi.useFakeTimers({ now: 0 });
    const { ui, state } = mount();
    const files = [file("Лев/.env", 10), file("Лев/vendor/a.js", 20), file("Лев/vendor/b.js", 30), file("Лев/doc.pdf", 40), file("Лев/broken.pdf", 50)];
    const secret = { reason: "secret", detail: "файлы .env, ключи и сертификаты не загружаются" };
    const build = { reason: "build", detail: "папки сборки и сторонних библиотек не загружаются" };
    const upload = vi.fn(async (list: IntakeDroppedFile[]) => list.map(({ path }) =>
      path.endsWith(".env") ? { path, refused: secret } : path.includes("/vendor/") ? { path, refused: build } : path.endsWith("broken.pdf") ? { path, error: "сбой" } : { path, uploadId: "u" }));
    await act(async () => { ui.reading("p1"); await runIntakeUpload(ui, plan(files), upload, "готово"); });
    const view = toUploadView(state());
    expect(view).toMatchObject({ phase: "done", files: 5, accepted: 1, failed: ["Лев/broken.pdf"], failedCount: 1 });
    expect((view as { refused: unknown }).refused).toEqual([
      { reason: "secret", label: "секреты", files: 1, examples: [".env"], detail: secret.detail },
      { reason: "build", label: "сторонний код", files: 2, examples: ["vendor"], detail: build.detail },
    ]);
    // Повтор берёт только настоящий сбой: отказанные файлы сервер всё равно не примет.
    await act(async () => { (state() as Extract<IntakeUploadPanelState, { phase: "done" }>).retry!(); });
    expect(upload.mock.calls[1][0].map(f => f.path)).toEqual(["Лев/broken.pdf"]);
    act(() => { vi.advanceTimersByTime(AUTO_CLOSE_MS * 2); });
    expect(toUploadView(state())).toMatchObject({ phase: "done", failedCount: 1, refused: [{ files: 1 }, { files: 2 }] });
  });
});
