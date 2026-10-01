// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
vi.mock("./AuthContext", () => ({ useAuthenticatedApi: () => ({ authenticatedApi: {} }) }));
vi.mock("./useVendorBranding", () => ({ useVendorBranding: () => ({}) }));
vi.mock("./components/chat/FolderProjectCard", () => ({ FolderProjectCard: () => null, useFolderProject: () => ({ offer: () => {} }) }));
vi.mock("./chatDocumentUpload", () => ({ uploadPreparedAttachment: async (_api: unknown, file: {name: string}) => ({id: file.name, name: file.name, mimeType: "application/pdf"}) }));
vi.mock("@cloudflare/kumo", async importOriginal => ({ ...await importOriginal<object>(), useKumoToastManager: () => ({ add: () => {} }) }));
import { ChatInput } from "./ChatInterface";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

test("Следующий текст и файл переживают завершение предыдущей отправки", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {finish = resolve;});
  const onSend = vi.fn((_message: unknown, _model: unknown, _capsules?: unknown, _attachments?: unknown) => pending);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ChatInput createCapsuleGatekeeper={async () => null} getOverseer={async () => ({deleteChatAttachment: vi.fn()}) as never}
      onSend={onSend} isAgentActive={false} models={[]} selectedModel={null} onModelChange={() => {}} seedText="Первое сообщение" seedNonce={1} />));
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement;
    const attach = async (name: string) => {
      Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["pdf"], name, {type: "application/pdf"})] });
      await act(async () => fileInput.dispatchEvent(new Event("change", {bubbles: true})));
      await flush();
    };
    await attach("first.pdf");
    const send = host.querySelector('button[aria-label="Отправить сообщение"]') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    act(() => send.click());
    expect(onSend).toHaveBeenCalledOnce();
    const sentFileLocked = (host.querySelector('button[aria-label="Удалить вложение"]') as HTMLButtonElement).disabled;
    const textarea = host.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Следующее сообщение");
      textarea.dispatchEvent(new Event("input", {bubbles: true}));
    });
    await attach("next.pdf");
    await act(async () => {finish(); await pending;});
    expect(textarea.value).toBe("Следующее сообщение");
    expect(sentFileLocked).toBe(true);
    expect(host.querySelector('[title="next.pdf"]')).not.toBeNull();
    expect(host.querySelector('[title="first.pdf"]')).toBeNull();
    expect((host.querySelector('button[aria-label="Удалить вложение"]') as HTMLButtonElement).disabled).toBe(false);
    expect(onSend.mock.calls[0]?.[0]).toBe("Первое сообщение");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
