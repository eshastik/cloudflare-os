// @vitest-environment jsdom
// Экран Mini App: данные запуска и токен уходят на сервер, ответ показывается; вне Telegram — ничего не шлёт.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import MiniApp, { OPEN_PATH, type TelegramWebApp } from "./MiniApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "a".repeat(64) + "." + "b".repeat(43);

function webApp(): TelegramWebApp & { closed: number; opened: string[] } {
  let app = { initData: "user=%7B%7D&signature=x", closed: 0, opened: [] as string[], ready: vi.fn(), expand: vi.fn(),
    close() { app.closed++; }, openLink(url: string) { app.opened.push(url); } };
  return app;
}

async function render(props: Parameters<typeof MiniApp>[0]) {
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
  await React.act(async () => root.render(<MiniApp {...props} />));
  await React.act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { el, done: async () => { await React.act(async () => root.unmount()); el.remove(); } };
}

const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

it("шлёт токен и initData, показывает документ и ведёт на свой сайт", async () => {
  const app = webApp();
  const site = window.location.origin + "/gatekeepers/mnemos?section=my-work";
  const fetcher = reply({ status: "ok", title: "План на квартал", siteUrl: site });
  const { el, done } = await render({ webApp: app, token: TOKEN, fetcher });
  try {
    const [path, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(OPEN_PATH);
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN, initData: app.initData });
    expect(init.credentials).toBe("omit");
    expect(el.querySelector("h1")?.textContent).toBe("План на квартал");
    await React.act(async () => [...el.querySelectorAll("button")].find(b => b.textContent === "Открыть на сайте")!.click());
    expect(app.opened).toEqual([site]);
    await React.act(async () => [...el.querySelectorAll("button")].find(b => b.textContent === "Закрыть")!.click());
    expect(app.closed).toBe(1);
  } finally { await done(); }
});

it("чужой адрес в ответе не становится ссылкой", async () => {
  const { el, done } = await render({ webApp: webApp(), token: TOKEN, fetcher: reply({ status: "ok", title: "Док", siteUrl: "https://evil.example/x" }) });
  try {
    expect([...el.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Закрыть"]);
  } finally { await done(); }
});

it("вне Telegram или без токена ничего не отправляет", async () => {
  for (const props of [{ webApp: null, token: TOKEN }, { webApp: webApp(), token: null }, { webApp: webApp(), token: "плохой" }]) {
    const fetcher = reply({ status: "ok", title: "x", siteUrl: null });
    const { el, done } = await render({ ...props, fetcher });
    try {
      expect(fetcher).not.toHaveBeenCalled();
      expect(el.textContent).toContain("Откройте из Telegram");
    } finally { await done(); }
  }
});

it("отказ и устаревшая кнопка объясняются словами", async () => {
  let r = await render({ webApp: webApp(), token: TOKEN, fetcher: reply({ status: "denied" }) });
  expect(r.el.textContent).toContain("Открыть не получилось");
  await r.done();
  r = await render({ webApp: webApp(), token: TOKEN, fetcher: reply({ status: "expired", siteUrl: null }) });
  expect(r.el.textContent).toContain("Кнопка устарела");
  await r.done();
});
