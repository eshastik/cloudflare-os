// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

test("копирование сохраняет Markdown для текста и HTML для редактора", async () => {
  const write = vi.fn<(items: unknown[]) => Promise<void>>(async () => {});
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  vi.stubGlobal("navigator", {clipboard: {write, writeText}});
  vi.stubGlobal("ClipboardItem", class { constructor(public data: Record<string, Blob>) {} });
  expect(await copyToClipboard("- Первый", "<ul><li>Первый</li></ul>")).toBe(true);
  const item = write.mock.calls[0][0][0] as {data: Record<string, Blob>};
  expect(Object.keys(item.data).sort()).toEqual(["text/html", "text/plain"]);
  expect(item.data["text/html"].type).toBe("text/html");
  expect(writeText).not.toHaveBeenCalled();
});

test("отказ форматированного буфера сохраняет доступность обычного копирования", async () => {
  const write = vi.fn<() => Promise<void>>(async () => {throw new Error("HTML не поддерживается");});
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  vi.stubGlobal("navigator", {clipboard: {write, writeText}});
  vi.stubGlobal("ClipboardItem", class {});
  expect(await copyToClipboard("- Первый", "<ul><li>Первый</li></ul>")).toBe(true);
  expect(writeText).toHaveBeenCalledWith("- Первый");
});
