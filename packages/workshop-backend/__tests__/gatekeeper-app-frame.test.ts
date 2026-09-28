import { describe, expect, it, vi } from "vitest";
import type { GatekeeperUiFrame } from "@gadgets/workshop-shared/gatekeeper";
import { frameForBrowser, knownFrameHashes, sha256Hex } from "../src/gatekeeper-app-frame";
import { findUiAccount, type UiAccountRecord } from "../src/ui-account";

const HTML = "<!doctype html><p>Приложение</p>";
const frame = (): GatekeeperUiFrame => ({ iframeHtml: HTML, ui: {} as GatekeeperUiFrame["ui"] });

describe("сборка фрейма по хешу", () => {
  it("неизвестный хеш — полная передача с хешем сборки", async () => {
    const hash = await sha256Hex(HTML);
    const sent = await frameForBrowser(frame(), 5, knownFrameHashes(["0".repeat(64)]));
    expect(sent).toMatchObject({ iframeHtml: HTML, iframeHtmlSha256: hash, accountId: 5 });
    expect(sent.iframeHtmlOmitted).toBeUndefined();
  });
  it("без хешей — полная передача", async () => {
    const sent = await frameForBrowser(frame(), 1, knownFrameHashes(undefined));
    expect(sent.iframeHtml).toBe(HTML);
  });
  it("известный хеш — сборка не передаётся", async () => {
    const hash = await sha256Hex(HTML);
    const sent = await frameForBrowser(frame(), 5, knownFrameHashes(["1".repeat(64), hash]));
    expect(sent).toMatchObject({ iframeHtml: "", iframeHtmlOmitted: true, iframeHtmlSha256: hash, accountId: 5 });
  });
  it("хеш сборки — SHA-256 в hex", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("хеши от браузера проверяются: формат и число", () => {
    expect(() => knownFrameHashes(["A".repeat(64)])).toThrow();
    expect(() => knownFrameHashes(["0".repeat(63)])).toThrow();
    expect(() => knownFrameHashes("0".repeat(64))).toThrow();
    expect(() => knownFrameHashes(Array.from({ length: 5 }, (_, i) => String(i).repeat(64)))).toThrow();
    expect(knownFrameHashes(["a".repeat(64)]).has("a".repeat(64))).toBe(true);
  });
});

describe("выбор подключения для страницы приложения", () => {
  const ui = { providesUi: { title: "Mnemos" } };
  const records: UiAccountRecord[] = [
    { id: 0, vendorId: "google", description: {} },
    { id: 1, vendorId: "mnemos", autoProvisioned: true, description: ui },
    { id: 2, vendorId: "mnemos", description: ui },
  ];
  it("известное подключение открывается без опроса шлюзов", async () => {
    const ensure = vi.fn(async () => {});
    expect(await findUiAccount({ records: () => records, dormant: () => false, ensure, vendorId: "mnemos" })).toBe(1);
    expect(await findUiAccount({ records: () => records, dormant: () => false, ensure, vendorId: "mnemos", accountId: 2 })).toBe(2);
    expect(ensure).not.toHaveBeenCalled();
  });
  it("нет подходящего — сначала заводятся недостающие, выбор после этого", async () => {
    const list: UiAccountRecord[] = [{ id: 0, vendorId: "google", description: {} }];
    const ensure = vi.fn(async () => { list.push({ id: 1, vendorId: "context", autoProvisioned: true, description: ui }); });
    expect(await findUiAccount({ records: () => list, dormant: () => false, ensure, vendorId: "context" })).toBe(1);
    expect(ensure).toHaveBeenCalledOnce();
    expect(await findUiAccount({ records: () => list, dormant: () => false, ensure: async () => {}, vendorId: "missing" })).toBeNull();
  });
  it("автоматическое подключение выключенного шлюза пропускается, как в listProvidedAccounts", async () => {
    const ensure = vi.fn(async () => {});
    expect(await findUiAccount({ records: () => records, dormant: r => r.vendorId === "mnemos", ensure, vendorId: "mnemos" })).toBe(2);
    expect(await findUiAccount({ records: () => records, dormant: () => false, ensure, vendorId: "mnemos", accountId: 7 })).toBeNull();
    expect(ensure).toHaveBeenCalledOnce();
  });
});
