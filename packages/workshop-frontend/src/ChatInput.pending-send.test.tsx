// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
vi.mock("./AuthContext", () => ({ useAuthenticatedApi: () => ({ authenticatedApi: {} }) }));
vi.mock("./useVendorBranding", () => ({ useVendorBranding: () => ({}) }));
vi.mock("./components/chat/FolderProjectCard", () => ({ FolderProjectCard: () => null, useFolderProject: () => ({ offer: () => {} }) }));
const { upload } = vi.hoisted(() => ({ upload: vi.fn(async (_api: unknown, file: {name: string; blob?: Blob}, _options: {retryId?: string; signal?: AbortSignal}) => ({id: file.name, name: file.name, mimeType: "application/pdf"})) }));
vi.mock("./chatDocumentUpload", () => ({ uploadPreparedAttachment: upload }));
vi.mock("@cloudflare/kumo", async importOriginal => ({ ...await importOriginal<object>(), useKumoToastManager: () => ({ add: () => {} }) }));
import { ChatInput } from "./ChatInterface";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

test("Вставленный список отправляется с форматированием без режима предпросмотра; незавершённый ввод не отправляет сообщение", async () => {
  const onSend = vi.fn<(message: unknown) => Promise<void>>(async () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ChatInput createCapsuleGatekeeper={async () => null} getOverseer={async () => ({}) as never}
      onSend={onSend} isAgentActive={false} models={[]} selectedModel={null} onModelChange={() => {}} seedText="Начало заменить конец" seedNonce={1} />));
    const textarea = host.querySelector("textarea")!;
    act(() => textarea.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true, cancelable: true})));
    expect(onSend).not.toHaveBeenCalled();
    textarea.setSelectionRange(7, 15);
    const paste = new Event("paste", {bubbles: true, cancelable: true});
    Object.defineProperty(paste, "clipboardData", {value: {items: [], getData: (type: string) => type === "text/html"
      ? '<ul><li><strong>Первое</strong><ul><li>Подпункт</li></ul></li><li>Второе</li></ul>' : "Первое\nПодпункт\nВторое"}});
    await act(async () => textarea.dispatchEvent(paste));
    expect(textarea.value).toMatch(/^Начало \n\n- +\*\*Первое\*\*/);
    expect(textarea.value).toMatch(/Второе\n\n конец$/);
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Предпросмотр")).toBe(false);
    expect(textarea.value).toContain("Подпункт");
    const message = textarea.value;
    await act(async () => (host.querySelector('button[aria-label="Отправить сообщение"]') as HTMLButtonElement).click());
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]).toBe(message);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

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

test("Ошибку загрузки можно повторить для того же файла и той же операции", async () => {
  upload.mockClear();
  upload.mockRejectedValueOnce(new Error("Связь с хранилищем прервалась"));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ChatInput createCapsuleGatekeeper={async () => null} getOverseer={async () => ({}) as never}
      onSend={async () => {}} isAgentActive={false} models={[]} selectedModel={null} onModelChange={() => {}} />));
    const file = new File(["pdf"], "big.pdf", {type: "application/pdf"});
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {configurable: true, value: [file]});
    await act(async () => input.dispatchEvent(new Event("change", {bubbles: true})));
    await flush();
    const retry = host.querySelector('button[aria-label="Повторить загрузку «big.pdf»"]') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    const first = upload.mock.calls[0];
    await act(async () => retry.click()); await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][1].blob).toBe(file);
    expect(upload.mock.calls[1][2].retryId).toBe(first[2].retryId);
    expect(first[2].retryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(host.querySelector('button[aria-label^="Повторить загрузку"]')).toBeNull();
    expect((host.querySelector('button[aria-label="Отправить сообщение"]') as HTMLButtonElement).disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

test("Удаление загружаемого файла прекращает передачу", async () => {
  upload.mockClear();
  upload.mockImplementationOnce(async (_api, file, options) => {
    await new Promise<void>((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(options.signal!.reason), {once: true}));
    return {id: file.name, name: file.name, mimeType: "application/pdf"};
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ChatInput createCapsuleGatekeeper={async () => null} getOverseer={async () => ({}) as never}
      onSend={async () => {}} isAgentActive={false} models={[]} selectedModel={null} onModelChange={() => {}} />));
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {configurable: true, value: [new File(["pdf"], "cancel.pdf", {type: "application/pdf"})]});
    await act(async () => input.dispatchEvent(new Event("change", {bubbles: true}))); await flush();
    const signal = upload.mock.calls[0][2].signal!;
    expect(signal.aborted).toBe(false);
    await act(async () => (host.querySelector('button[aria-label="Удалить вложение"]') as HTMLButtonElement).click()); await flush();
    expect(signal.aborted).toBe(true);
    expect(host.querySelector('[title="cancel.pdf"]')).toBeNull();
    expect(host.querySelector('button[aria-label^="Повторить загрузку"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
