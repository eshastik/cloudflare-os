// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { observeWorkspaceActivity, reportEmbeddedWorkspaceActivity } from "./workspaceActivity";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("records an inactive break when focus was lost during an in-flight heartbeat", async () => {
  vi.useFakeTimers();
  let now = 0, focused = true;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const listeners = vi.spyOn(window, "addEventListener");
  let release: (() => void) | undefined;
  const record = vi.fn(async (_stream: string, sequence: number, _active: boolean) => {
    if (sequence === 3) await new Promise<void>(resolve => { release = resolve; });
  });
  const stop = observeWorkspaceActivity({ recordOwnWorkspaceActivity: record });
  const listener = listeners.mock.calls.find(args => args[0] === "pointerdown")![1] as EventListener;
  try {
    await Promise.resolve();
    listener({ isTrusted: false } as Event);
    now = 15000; await vi.advanceTimersByTimeAsync(15000);
    expect(record.mock.calls[1][2]).toBe(false);
    listener({ isTrusted: true } as Event);
    now = 30000; await vi.advanceTimersByTimeAsync(15000);
    expect(record.mock.calls[2][2]).toBe(true);
    focused = false; window.dispatchEvent(new Event("blur"));
    focused = true; listener({ isTrusted: true } as Event);
    release!(); await Promise.resolve(); await Promise.resolve();
    now = 45000; await vi.advanceTimersByTimeAsync(15000);
    expect(record.mock.calls[3][2]).toBe(false);
    now = 60000; await vi.advanceTimersByTimeAsync(15000);
    expect(record.mock.calls[4][2]).toBe(true);
    now = 100000; await vi.advanceTimersByTimeAsync(15000);
    expect(record.mock.calls[5][2]).toBe(false);
  } finally { stop(); }
  const calls = record.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(record).toHaveBeenCalledTimes(calls);
});

it("accepts activity only from the current focused visible sandbox and feeds the same collector", async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockReturnValue(1000);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const frame = document.createElement("iframe"), other = document.createElement("iframe");
  document.body.append(frame, other);
  const record = vi.fn(async (_stream: string, _sequence: number, _active: boolean) => {});
  const stop = observeWorkspaceActivity({ recordOwnWorkspaceActivity: record });
  const message = (source = frame.contentWindow, origin = "null", type = "workspace-activity") => new MessageEvent("message", { source, origin, data: { type } });
  try {
    await Promise.resolve();
    frame.focus();
    expect(reportEmbeddedWorkspaceActivity(message(other.contentWindow), frame, true)).toBe(false);
    expect(reportEmbeddedWorkspaceActivity(message(frame.contentWindow, "https://foreign.example"), frame, true)).toBe(false);
    expect(reportEmbeddedWorkspaceActivity(message(), frame, false)).toBe(false);
    other.focus();
    expect(reportEmbeddedWorkspaceActivity(message(), frame, true)).toBe(false);
    frame.focus(); visibility.mockReturnValue("hidden");
    expect(reportEmbeddedWorkspaceActivity(message(), frame, true)).toBe(false);
    visibility.mockReturnValue("visible");
    await vi.advanceTimersByTimeAsync(15000);
    expect(record.mock.calls.at(-1)?.[2]).toBe(false);
    expect(reportEmbeddedWorkspaceActivity(message(), frame, true)).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(record.mock.calls.at(-1)?.[2]).toBe(true);
    frame.remove();
    expect(reportEmbeddedWorkspaceActivity(message(), frame, true)).toBe(false);
  } finally { stop(); frame.remove(); other.remove(); }
});
