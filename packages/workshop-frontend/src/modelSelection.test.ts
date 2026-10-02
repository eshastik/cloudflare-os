// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getStoredSelectedModel, NO_AGENT_OPTION_VALUE } from "./modelSelection";
const models = [{ type: "agent" as const, id: "other", name: "Другая модель" }, { type: "agent" as const, id: "mnemos-assistant", name: "Mnemos Assistant" }];
afterEach(() => localStorage.clear());
describe("агент обязателен", () => {
  it("Mnemos выбран по умолчанию независимо от порядка", () => { expect(getStoredSelectedModel(models)).toBe("mnemos-assistant"); });
  it("старый режим без агента заменяется на Mnemos", () => { localStorage.setItem("lastSelectedModel", NO_AGENT_OPTION_VALUE); expect(getStoredSelectedModel(models)).toBe("mnemos-assistant"); });
  it("явный выбор другой доступной модели сохраняется", () => { localStorage.setItem("lastSelectedModel", "other"); expect(getStoredSelectedModel(models)).toBe("other"); });
});
