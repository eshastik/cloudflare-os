// Код приложения закрыт (ADR 0028, п. 4): агент беседы не читает и не правит код гаджета-узла Mnemos,
// гаджет беседы и встроенный редактор — как раньше.
import { describe, expect, it } from "vitest";
import type { BlueprintOutput } from "@gadgets/workshop-shared/api";
import type { MnemosAppBinding } from "@gadgets/workshop-shared/gadget-app";
import { agentFileLock, appCodeLock } from "../src/native-editor-guard";
import { closedAppCode } from "../src/overseer";

const binding: MnemosAppBinding = { accountId: 1, scope: "p", resource: "n", description: "", collaborative: true, session: true, permissions: [] };
const document = { id: "cloudflareos.document", noun: "Документ" } as unknown as BlueprintOutput;

describe("код гаджета-узла Mnemos закрыт для агента беседы", () => {
  it("гаджет привязан к узлу хотя бы у одного человека — код закрыт; без привязки — открыт", () => {
    expect(closedAppCode({ mnemosApps: { u1: binding } })).toBe(true);
    expect(closedAppCode({ mnemosApps: {} })).toBe(false);
    expect(closedAppCode({})).toBe(false);
  });

  it("файловые инструменты: гаджет-узел — отказ на чтение и запись с подсказкой про агента кода", () => {
    for (const write of [false, true]) {
      const lock = agentFileLock({ closedCode: true }, "LIST", write);
      expect(lock).toBe(appCodeLock("LIST"));
      expect(lock).toMatch(/gadgetWork/);
      expect(lock).toMatch(/не приводи/);
    }
  });

  it("гаджет беседы — читать и править можно; встроенный редактор — читать можно, править нельзя", () => {
    expect(agentFileLock({}, "APP", false)).toBeNull();
    expect(agentFileLock({}, "APP", true)).toBeNull();
    expect(agentFileLock(undefined, "APP", true)).toBeNull();
    expect(agentFileLock({ output: document }, "DOC", false)).toBeNull();
    expect(agentFileLock({ output: document }, "DOC", true)).toMatch(/встроенный редактор/);
  });
});
