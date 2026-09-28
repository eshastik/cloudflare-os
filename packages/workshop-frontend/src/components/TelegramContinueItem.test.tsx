// @vitest-environment jsdom
import * as React from "react";
import {createRoot} from "react-dom/client";
import {DropdownMenu} from "@cloudflare/kumo";
import {afterEach, expect, it, vi} from "vitest";
import type {TelegramChatLink} from "@gadgets/workshop-shared/telegram-bot";
import {TelegramContinueItem} from "./TelegramContinueItem";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const toasts = vi.hoisted(() => ({add: vi.fn()}));
vi.mock("@cloudflare/kumo", async importOriginal => ({...await importOriginal<typeof import("@cloudflare/kumo")>(), useKumoToastManager: () => toasts}));

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

async function menu(overseer: {getTelegramLink: (chatId: number) => Promise<TelegramChatLink>; continueInTelegram: (chatId: number) => Promise<TelegramChatLink>}) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await React.act(async () => root.render(
    <DropdownMenu>
      <DropdownMenu.Trigger render={<button type="button">Действия с беседой</button>} />
      <DropdownMenu.Content><TelegramContinueItem overseer={overseer} chatId={3} /></DropdownMenu.Content>
    </DropdownMenu>,
  ));
  await React.act(async () => { el.querySelector("button")!.click(); });
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const item = (text: string) => [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent?.includes(text)) as HTMLElement | undefined;
  return {root, item};
}

it("бот не подключён — пункта нет", async () => {
  const {root, item} = await menu({getTelegramLink: async () => ({status: "unavailable"}), continueInTelegram: vi.fn()});
  expect(item("Telegram")).toBeUndefined();
  await React.act(async () => root.unmount());
});

it("«Продолжить в Telegram» создаёт тред, после этого пункт ведёт в чат с ботом", async () => {
  const linked: TelegramChatLink = {status: "linked", bot: "alice_helper_bot", url: "https://t.me/alice_helper_bot"};
  const continueInTelegram = vi.fn(async () => linked);
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const {root, item} = await menu({getTelegramLink: async () => ({status: "available", bot: "alice_helper_bot"}), continueInTelegram});
  expect(item("Продолжить в Telegram")).toBeDefined();
  await React.act(async () => { item("Продолжить в Telegram")!.click(); });
  expect(continueInTelegram).toHaveBeenCalledWith(3);
  expect(toasts.add).toHaveBeenCalledWith({title: "Беседа продолжается в Telegram: тред открыт у @alice_helper_bot", variant: "success"});
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const again = await menu({getTelegramLink: async () => linked, continueInTelegram});
  await React.act(async () => { again.item("Открыть в Telegram")!.click(); });
  expect(open).toHaveBeenCalledWith("https://t.me/alice_helper_bot", "_blank", "noopener,noreferrer");
  expect(continueInTelegram).toHaveBeenCalledOnce();
  await React.act(async () => { root.unmount(); again.root.unmount(); });
});
