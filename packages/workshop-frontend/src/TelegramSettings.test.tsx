// @vitest-environment jsdom
// «Telegram» в личных настройках: токен → проверка бота → «/start КОД» → подключено; треды обязательны.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { TelegramBotState } from "@gadgets/workshop-shared/telegram-bot";

const api = vi.hoisted(() => ({
  getTelegramBot: vi.fn<() => Promise<unknown>>(),
  connectTelegramBot: vi.fn<(token: string) => Promise<unknown>>(),
  renewTelegramCode: vi.fn<() => Promise<unknown>>(),
  disconnectTelegramBot: vi.fn<() => Promise<unknown>>(),
  getNotificationSettings: vi.fn<() => Promise<unknown>>(async () => null),
  saveNotificationSettings: vi.fn<(kinds: Record<string, boolean>) => Promise<unknown>>(),
}));
vi.mock("./AuthContext", () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }));
import TelegramSettings from "./TelegramSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOT = { username: "alice_helper_bot", title: "Помощник Алисы" };
const ON = { enabled: true, usersCanCreate: true };
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ";

async function render() {
  const root = createRootRoute({ component: TelegramSettings });
  const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/"] }), routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: "/settings" })]) });
  const el = document.createElement("div"); document.body.append(el); const r = createRoot(el);
  await React.act(async () => r.render(<RouterProvider router={router} />));
  return { el, done: async () => { await React.act(async () => r.unmount()); el.remove(); } };
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await React.act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find(b => b.textContent === text) as HTMLButtonElement | undefined;

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

it("без ключа на сервере объясняет, что делать, и не показывает форму токена", async () => {
  api.getTelegramBot.mockResolvedValue({ status: "unavailable", reason: "no_key" } satisfies TelegramBotState);
  const { el, done } = await render();
  try {
    expect(el.textContent).toContain("Подключить бота пока нельзя");
    expect(el.textContent).toContain("администратора установки");
    expect(el.querySelector("input")).toBeNull();
  } finally { await done(); }
});

it("токен → бот без тредов: инструкция BotFather и «Проверить снова» с тем же токеном → код", async () => {
  api.getTelegramBot.mockResolvedValue({ status: "none" } satisfies TelegramBotState);
  api.connectTelegramBot
    .mockResolvedValueOnce({ status: "needs_threads", bot: BOT, threads: { enabled: false, usersCanCreate: true } } satisfies TelegramBotState)
    .mockResolvedValueOnce({ status: "pairing", bot: BOT, threads: ON, code: "abcd2345efgh", expiresAt: Date.now() + 600_000 } satisfies TelegramBotState);
  const { el, done } = await render();
  try {
    const input = el.querySelector<HTMLInputElement>("#telegram-token")!;
    expect(input.type).toBe("password");
    await type(input, "  " + TOKEN + " ");
    await React.act(async () => button(el, "Проверить бота")!.click());
    expect(api.connectTelegramBot).toHaveBeenLastCalledWith(TOKEN);
    expect(el.textContent).toContain("выключен режим тредов");
    expect(el.textContent).toContain("Threads Settings");
    expect(el.textContent).toContain("Threaded Mode");
    expect(input.value.trim()).toBe(TOKEN);
    await React.act(async () => button(el, "Проверить снова")!.click());
    expect(api.connectTelegramBot).toHaveBeenCalledTimes(2);
    expect(api.connectTelegramBot).toHaveBeenLastCalledWith(TOKEN);
    expect(el.querySelector('[aria-label="Команда для бота"]')?.textContent).toBe("/start abcd2345efgh");
    const open = [...el.querySelectorAll("a")].find(a => a.textContent === "Открыть бота в Telegram");
    expect(open?.getAttribute("href")).toBe("https://t.me/alice_helper_bot?start=abcd2345efgh");
    expect(el.querySelector('[aria-current="step"]')?.textContent).toContain("Код из Telegram");
    // Токен не остаётся на странице после подключения.
    expect(el.innerHTML).not.toContain(TOKEN);
  } finally { await done(); }
});

it("ошибка сервера показывается словами, английская — общим текстом", async () => {
  api.getTelegramBot.mockResolvedValue({ status: "none" } satisfies TelegramBotState);
  api.connectTelegramBot.mockRejectedValueOnce(new Error("Этот бот уже подключён у другого пользователя."))
    .mockRejectedValueOnce(new Error("internal error"));
  const { el, done } = await render();
  try {
    await type(el.querySelector<HTMLInputElement>("#telegram-token")!, TOKEN);
    await React.act(async () => button(el, "Проверить бота")!.click());
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Этот бот уже подключён у другого пользователя.");
    await React.act(async () => button(el, "Проверить бота")!.click());
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Бот не подключился. Проверьте токен и повторите.");
  } finally { await done(); }
});

it("пока ждём код, состояние перечитывается и сменяется на «подключено»", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  api.getTelegramBot
    .mockResolvedValueOnce({ status: "pairing", bot: BOT, threads: ON, code: "abcd2345efgh", expiresAt: Date.now() + 600_000 } satisfies TelegramBotState)
    .mockResolvedValue({ status: "connected", bot: BOT, threads: ON, owner: { name: "Алиса", username: "alice" }, connectedAt: Date.UTC(2026, 8, 29) } satisfies TelegramBotState);
  const { el, done } = await render();
  try {
    expect(el.textContent).toContain("/start abcd2345efgh");
    await React.act(async () => { vi.advanceTimersByTime(3000); });
    expect(el.textContent).toContain("Алиса (@alice)");
    expect(el.textContent).toContain("Включены");
  } finally { await done(); }
});

it("подключённый бот: выключенные треды — предупреждение; отключение — после подтверждения", async () => {
  api.getTelegramBot
    .mockResolvedValueOnce({ status: "connected", bot: BOT, threads: { enabled: false, usersCanCreate: true }, owner: { name: "Алиса", username: null }, connectedAt: Date.UTC(2026, 8, 29) } satisfies TelegramBotState)
    .mockResolvedValue({ status: "none" } satisfies TelegramBotState);
  api.disconnectTelegramBot.mockResolvedValue({ webhookRemoved: true });
  const { el, done } = await render();
  try {
    expect(el.textContent).toContain("Треды выключены");
    expect(el.textContent).toContain("Выключены");
    await React.act(async () => button(el, "Отключить бота")!.click());
    expect(api.disconnectTelegramBot).not.toHaveBeenCalled();
    await React.act(async () => button(el, "Да, отключить")!.click());
    expect(api.disconnectTelegramBot).toHaveBeenCalledOnce();
    expect(el.querySelector("#telegram-token")).not.toBeNull();
  } finally { await done(); }
});

const CONNECTED = { status: "connected", bot: BOT, threads: ON, owner: { name: "Алиса", username: null }, connectedAt: Date.now() } satisfies TelegramBotState;
const KINDS = { decision_needed: true, task_result: true, shared_with_me: false, platform_failure: false };
const switches = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];

it("уведомления: три вида у обычного человека, переключение сохраняет все четыре", async () => {
  api.getTelegramBot.mockResolvedValue(CONNECTED);
  api.getNotificationSettings.mockResolvedValue({ kinds: KINDS, platformFailure: false });
  api.saveNotificationSettings.mockImplementation(async kinds => ({ kinds, platformFailure: false }));
  const { el, done } = await render();
  try {
    expect(el.textContent).toContain("Уведомления");
    expect(el.textContent).not.toContain("Сбои системы");
    const list = switches(el);
    expect(list.map(b => b.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
    await React.act(async () => list[2].click());
    expect(api.saveNotificationSettings).toHaveBeenCalledWith({ ...KINDS, shared_with_me: true });
    expect(switches(el)[2].getAttribute("aria-checked")).toBe("true");
  } finally { await done(); }
});

it("уведомления: администратор видит «Сбои системы»", async () => {
  api.getTelegramBot.mockResolvedValue(CONNECTED);
  api.getNotificationSettings.mockResolvedValue({ kinds: { ...KINDS, platform_failure: true }, platformFailure: true });
  const { el, done } = await render();
  try {
    expect(el.textContent).toContain("Сбои системы");
    expect(switches(el)).toHaveLength(4);
  } finally { await done(); }
});

it("уведомления: без подключения Mnemos — объяснение вместо переключателей; сбой сохранения — сообщение", async () => {
  api.getTelegramBot.mockResolvedValue(CONNECTED);
  api.getNotificationSettings.mockResolvedValueOnce(null);
  let first = await render();
  try {
    expect(first.el.textContent).toContain("Подключите Mnemos");
    expect(switches(first.el)).toHaveLength(0);
  } finally { await first.done(); }
  api.getNotificationSettings.mockResolvedValue({ kinds: KINDS, platformFailure: false });
  api.saveNotificationSettings.mockRejectedValue(new Error("Не получилось прочитать или сохранить настройки уведомлений. Обновите страницу и повторите."));
  const { el, done } = await render();
  try {
    await React.act(async () => switches(el)[0].click());
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Не получилось");
    expect(switches(el)[0].getAttribute("aria-checked")).toBe("true");
  } finally { await done(); }
});
