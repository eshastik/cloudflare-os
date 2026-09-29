// @vitest-environment jsdom
// Фрейм редактора Mini App: страница не разрешает data:-скрипты, фрейм грузится своим адресом
// в песочнице без allow-same-origin и получает разметку редактора сообщением только после «готов».
import * as React from "react";
import pageHtml from "../../telegram-app.html?raw";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MINI_APP_EDITOR_FRAME_CSP, MINI_APP_EDITOR_FRAME_PATH } from "@gadgets/workshop-shared/telegram-mini-app";
import EditorFrame from "./EditorFrame";
import type { DocumentApi } from "./miniAppDocument";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split(";").map(part => part.trim().split(/\s+/)).filter(p => p[0]).map(([name, ...values]) => [name, values]));
}

it("в CSP страницы Mini App нет data: для скриптов, фреймы — только своя установка", () => {
  const policy = pageHtml.match(/<meta http-equiv="Content-Security-Policy" data-mini-app-csp content="([^"]*)"/)?.[1];
  expect(policy).toBeDefined();
  const csp = directives(policy!);
  expect(csp.get("script-src")).toBeDefined();
  expect(csp.get("script-src")).not.toContain("data:");
  expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
  expect(csp.get("frame-src")).toEqual(["'self'"]);
  // Во фрейме data:-модули разрешены: это его политика, не страницы.
  expect(directives(MINI_APP_EDITOR_FRAME_CSP).get("script-src")).toContain("data:");
  expect(directives(MINI_APP_EDITOR_FRAME_CSP).get("connect-src")).toEqual(["'none'"]);
});

it("фрейм грузится своим адресом в песочнице и получает редактор только от себя и после «готов»", async () => {
  const api = { getUiBundle: vi.fn(async () => ({ jsCode: "console.log('редактор')" })) } as unknown as DocumentApi;
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
  await React.act(async () => root.render(<EditorFrame api={api} accent="#176b9a" onSnapshotSource={() => {}} onFailed={() => {}} />));
  await React.act(async () => { await new Promise(r => setTimeout(r, 0)); });
  try {
    const frame = el.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(MINI_APP_EDITOR_FRAME_PATH);
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    // Чужое окно и не-песочница не получают разметку.
    window.dispatchEvent(new MessageEvent("message", { data: { type: "editor-frame-ready" }, origin: "null", source: window }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "editor-frame-ready" }, origin: window.location.origin, source: frame.contentWindow }));
    expect(post).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "editor-frame-ready" }, origin: "null", source: frame.contentWindow }));
    expect(post).toHaveBeenCalledTimes(1);
    const [message, target] = post.mock.calls[0] as [{ type: string; html: string }, string];
    expect(message.type).toBe("editor-frame-html");
    expect(decodeURIComponent(message.html)).toContain("console.log('редактор')");
    expect(target).toBe("*");
  } finally {
    await React.act(async () => root.unmount()); el.remove();
  }
});
