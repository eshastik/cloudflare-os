// @vitest-environment jsdom
// Документ в Mini App: состояние сохранения на главной кнопке Telegram, сохранение от версии, с которой
// правит редактор, чужая правка, «Версии» с кнопкой «Назад», конец сессии; тема и акцент — только HEX.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { MiniAppDocumentInfo } from "@gadgets/workshop-shared/telegram-mini-app";
import DocumentScreen from "./DocumentScreen";
import MiniApp from "./MiniApp";
import { applyTelegramTheme, type TelegramWebApp } from "./telegram";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = "a".repeat(64) + "." + "b".repeat(43);
const HEAD = "1".repeat(64);
const ORIGIN = "https://mnemos.example.ru";

function telegram() {
  const button = () => {
    const b = { text: "", visible: false, active: true, clicks: [] as (() => void)[],
      setText(t: string) { b.text = t }, show() { b.visible = true }, hide() { b.visible = false }, enable() { b.active = true }, disable() { b.active = false },
      setParams: vi.fn(), onClick(cb: () => void) { b.clicks.push(cb) }, offClick(cb: () => void) { b.clicks = b.clicks.filter(c => c !== cb) } }
    return b
  }
  const main = button(), back = button()
  const app = { initData: "x", colorScheme: "dark" as const, themeParams: { bg_color: "#17212b", text_color: "#f5f5f5" }, ready: vi.fn(), close: vi.fn(),
    MainButton: main, BackButton: back, enableClosingConfirmation: vi.fn(), disableClosingConfirmation: vi.fn(), openLink: vi.fn() }
  return { app: app as unknown as TelegramWebApp, main, back }
}

function fakeApi(info: Partial<MiniAppDocumentInfo> = {}, options: { revision?: number; saveError?: string; describeError?: string } = {}) {
  const calls: string[] = []
  let current: MiniAppDocumentInfo = { title: "План продаж", format: "cloudflareos.document", accent: "#176b9a", storageOrigin: ORIGIN, sitePath: "/workspace/w?chat=1",
    mnemos: { kind: "bound", access: "owner", savedHead: HEAD, savedRevision: 3 }, ...info }
  const revision = { value: options.revision ?? 3 }
  const api = {
    close: async () => { calls.push("close") },
    describe: async () => { if (options.describeError) throw new Error(options.describeError); calls.push("describe"); return current },
    connectEditor: async () => ({ getDocument: async () => ({ revision: revision.value }), restoreDocumentSnapshot: async (_s: unknown, r: number) => { calls.push(`restore:${r}`) }, [Symbol.dispose]() {} }),
    writer: async () => ({
      head: async () => { calls.push("head"); return "9".repeat(64) },
      issue: async (head: string, size: number, checksum: string) => { calls.push(`issue:${head}`); return { upload_id: "u1", url: ORIGIN + "/put", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size } },
      save: async (head: string, upload: string, rev: number | null) => {
        if (options.saveError) throw new Error(options.saveError)
        calls.push(`save:${head}:${upload}:${rev}`)
        current = { ...current, mnemos: { kind: "bound", access: "owner", savedHead: "2".repeat(64), savedRevision: rev } }
        return "2".repeat(64)
      },
      [Symbol.dispose]() {},
    }),
    versions: async () => ({ versions: [{ id: "v2", recordedAt: "2026-09-28T10:00:00Z", author: "Алиса", onBehalfOf: "" }, { id: "v1", recordedAt: "2026-09-27T10:00:00Z", author: "Агент", onBehalfOf: "Алиса" }], nextCursor: "" }),
    version: async (id: string) => ({
      issue: async () => { calls.push(`version:${id}`); const body = JSON.stringify({ format: "cloudflareos.document", formatVersion: 1, document: { revision: 1, title: "Старое" } });
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, "0")).join("")
        ;(globalThis as { __body?: string }).__body = body
        return { url: ORIGIN + "/get", method: "GET", size_bytes: new TextEncoder().encode(body).byteLength, sha256_hex: digest, content_type: "application/json" } },
      validate: async () => { calls.push("validate") }, [Symbol.dispose]() {},
    }),
  }
  const connect = vi.fn(() => ({ api: api as never, close: vi.fn() }))
  return { api, connect, calls, revision }
}

// Редактор в jsdom не запускается: подставной фрейм отдаёт снимок сразу.
function StubFrame({ onSnapshotSource }: { onSnapshotSource(read: unknown): void }) {
  React.useEffect(() => { onSnapshotSource(async () => ({ format: "cloudflareos.document", formatVersion: 1, document: { revision: 7, title: "План" } })); return () => onSnapshotSource(null) }, [])
  return <div className="stub-editor" />
}

async function render(node: React.ReactNode) {
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el)
  await React.act(async () => root.render(node))
  await settle()
  return { el, done: async () => { await React.act(async () => root.unmount()); el.remove() } }
}
const settle = async () => { for (let i = 0; i < 6; i++) await React.act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute("style"); delete document.documentElement.dataset.theme })

it("без правок — «Сохранено» и неактивна; правка — «Сохранить»; сохранение от версии, с которой правит редактор", async () => {
  const t = telegram(), f = fakeApi({}, { revision: 3 })
  const put = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 200 }))
  const r = await render(<DocumentScreen session={SESSION} webApp={t.app} siteUrl={null} title="План" connect={f.connect} pollMs={5} Frame={StubFrame as never} />)
  try {
    expect(f.connect).toHaveBeenCalledWith(SESSION)
    expect(r.el.querySelector("h1")?.textContent).toBe("План продаж")
    expect(t.main).toMatchObject({ text: "Сохранено", active: false, visible: true })
    f.revision.value = 7
    await settle(); await React.act(async () => { await new Promise(res => setTimeout(res, 20)) })
    expect(t.main).toMatchObject({ text: "Сохранить", active: true })
    expect(r.el.textContent).toContain("есть несохранённые правки")
    await React.act(async () => { t.main.clicks.at(-1)!() })
    await settle()
    // База — savedHead привязки, а не текущая голова: чужую правку не затереть молча.
    expect(f.calls).toContain(`issue:${HEAD}`)
    expect(f.calls).toContain(`save:${HEAD}:u1:7`)
    expect(f.calls).not.toContain("head")
    expect(put).toHaveBeenCalledWith(ORIGIN + "/put", expect.objectContaining({ method: "PUT", credentials: "omit" }))
    expect(r.el.textContent).toContain("Новая версия сохранена")
  } finally { await r.done() }
})

it("документ изменили после открытия — правка не записана, кнопка неактивна, объяснение", async () => {
  const t = telegram(), f = fakeApi({}, { revision: 7, saveError: "DOCUMENT_CHANGED" })
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 200 }))
  const r = await render(<DocumentScreen session={SESSION} webApp={t.app} siteUrl={null} title="План" connect={f.connect} pollMs={5} Frame={StubFrame as never} />)
  try {
    await React.act(async () => { t.main.clicks.at(-1)!() })
    await settle()
    expect(r.el.querySelector("[role=alert]")?.textContent).toContain("Документ изменили")
    expect(t.main.active).toBe(false)
  } finally { await r.done() }
})

it("«Версии»: «Назад» Telegram закрывает список; возврат версии кладёт её в редактор с текущей ревизией", async () => {
  const t = telegram(), f = fakeApi()
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response((globalThis as { __body?: string }).__body ?? ""))
  const r = await render(<DocumentScreen session={SESSION} webApp={t.app} siteUrl={null} title="План" connect={f.connect} pollMs={0} Frame={StubFrame as never} />)
  try {
    await React.act(async () => { (r.el.querySelector(".md-versions") as HTMLButtonElement).click() })
    await settle()
    expect(t.back.visible).toBe(true)
    expect(t.main.visible).toBe(false)
    expect([...r.el.querySelectorAll(".md-row-who")].map(e => e.textContent)).toEqual(["Алиса", "Агент по просьбе: Алиса"])
    await React.act(async () => { t.back.clicks.at(-1)!() })
    expect(r.el.querySelector(".md-sheet")).toBeNull()
    await React.act(async () => { (r.el.querySelector(".md-versions") as HTMLButtonElement).click() })
    await settle()
    await React.act(async () => { (r.el.querySelectorAll(".md-row")[1] as HTMLButtonElement).click() })
    await React.act(async () => { [...r.el.querySelectorAll("button")].find(b => b.textContent === "Вернуть эту версию")!.click() })
    await settle()
    expect(f.calls).toEqual(expect.arrayContaining(["version:v1", "validate", "restore:7"]))
    expect(r.el.querySelector(".md-sheet")).toBeNull()
  } finally { await r.done() }
})

it("сессия закончилась — экран говорит, что делать; редактора нет", async () => {
  const t = telegram(), f = fakeApi({}, { describeError: "Сессия Mini App закончилась. Нажмите «Открыть» в Telegram ещё раз." })
  const r = await render(<DocumentScreen session={SESSION} webApp={t.app} siteUrl={null} title="План" connect={f.connect} pollMs={0} Frame={StubFrame as never} />)
  try {
    expect(r.el.textContent).toContain("Сессия закончилась")
    expect(r.el.querySelector(".stub-editor")).toBeNull()
  } finally { await r.done() }
})

it("«Закрыть» и уход страницы закрывают сессию на сервере", async () => {
  const t = telegram(), f = fakeApi({}, { describeError: "Сессия Mini App закончилась." })
  const r = await render(<DocumentScreen session={SESSION} webApp={t.app} siteUrl={null} title="План" connect={f.connect} pollMs={0} Frame={StubFrame as never} />)
  try {
    await React.act(async () => { [...r.el.querySelectorAll("button")].find(b => b.textContent === "Закрыть")!.click() })
    expect(f.calls.filter(c => c === "close")).toHaveLength(1)
    expect(t.app.close).toHaveBeenCalled()
    await React.act(async () => { dispatchEvent(new Event("pagehide")) })
    expect(f.calls.filter(c => c === "close")).toHaveLength(2)
  } finally { await r.done() }
})

it("документ не в Mnemos и без проекта — главной кнопки нет, путь на сайт назван", async () => {
  const t = telegram(), f = fakeApi({ mnemos: { kind: "none" } })
  const r = await render(<DocumentScreen session={SESSION} webApp={t.app} siteUrl={null} title="План" connect={f.connect} pollMs={0} Frame={StubFrame as never} />)
  try {
    expect(t.main.visible).toBe(false)
    expect(r.el.textContent).toContain("сохраняется на сайте")
  } finally { await r.done() }
})

it("тема Telegram и акцент — только HEX; тёмная тема переносится", () => {
  const t = telegram()
  applyTelegramTheme({ ...t.app, themeParams: { bg_color: "#17212b", text_color: "red;x:url(y)" } }, "#176b9a")
  const style = document.documentElement.style
  expect(document.documentElement.dataset.theme).toBe("dark")
  expect(style.getPropertyValue("--base")).toBe("#17212b")
  expect(style.getPropertyValue("--text")).toBe("")
  expect(style.getPropertyValue("--brand")).toMatch(/^#[0-9a-f]{6}$/)
  applyTelegramTheme(null, "javascript:x")
  expect(style.getPropertyValue("--base")).toBe("")
})

it("ответ с сессией открывает редактор документа; сессия не по форме — нет", async () => {
  const seen: string[] = []
  const Screen = (({ session }: { session: string }) => { seen.push(session); return <p>редактор</p> }) as unknown as typeof DocumentScreen
  const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch
  const token = "a".repeat(64) + "." + "b".repeat(43)
  let r = await render(<MiniApp webApp={telegram().app} token={token} fetcher={reply({ status: "ok", title: "План", siteUrl: null, session: SESSION })} documentScreen={Screen} />)
  expect(seen).toContain(SESSION)
  await r.done()
  r = await render(<MiniApp webApp={telegram().app} token={token} fetcher={reply({ status: "ok", title: "План", siteUrl: null, session: "плохая" })} documentScreen={Screen} />)
  expect(r.el.textContent).toContain("Это открывается на сайте")
  await r.done()
})
