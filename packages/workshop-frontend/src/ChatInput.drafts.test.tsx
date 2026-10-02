// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
vi.mock("./AuthContext", () => ({useAuthenticatedApi: () => ({authenticatedApi: {}, currentUser: {id: "draft-user"}})}));
vi.mock("./useVendorBranding", () => ({useVendorBranding: () => ({})}));
vi.mock("./components/chat/FolderProjectCard", () => ({FolderProjectCard: () => null, useFolderProject: () => ({offer: () => {}})}));
vi.mock("@cloudflare/kumo", async original => ({...await original<object>(), useKumoToastManager: () => ({add: () => {}})}));
import { ChatInput } from "./ChatInterface";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

test("Черновики разных бесед переживают переход и перезагрузку; успешная отправка очищает только свой черновик", async () => {
  sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", class {observe() {} disconnect() {}});
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  const send = vi.fn(async () => {});
  const render = (chat: number) => act(async () => root.render(<ChatInput key={chat} chatKey={chat}
    createCapsuleGatekeeper={async () => null} getOverseer={async () => ({}) as never}
    onSend={send} isAgentActive={false} models={[]} selectedModel={null} onModelChange={() => {}} />));
  const type = (text: string) => act(() => {
    const input = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  try {
    await render(1); type("Первый черновик");
    await render(2); expect(host.querySelector("textarea")!.value).toBe(""); type("Второй черновик");
    await render(1); expect(host.querySelector("textarea")!.value).toBe("Первый черновик");
    await act(async () => root.unmount()); root = createRoot(host);
    await render(2); expect(host.querySelector("textarea")!.value).toBe("Второй черновик");
    await act(async () => (host.querySelector('button[aria-label="Отправить сообщение"]') as HTMLButtonElement).click());
    expect(send).toHaveBeenCalledOnce();
    await render(1); expect(host.querySelector("textarea")!.value).toBe("Первый черновик");
    await render(2); expect(host.querySelector("textarea")!.value).toBe("");
  } finally { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); }
});
