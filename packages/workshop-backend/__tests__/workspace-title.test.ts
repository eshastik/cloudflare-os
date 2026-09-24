import { describe, it, expect } from "vitest";
import { DEFAULT_WORKSPACE_TITLE, displayWorkspaceTitle, isDefaultWorkspaceTitle, russianTitle } from "../src/workspace-title";
describe("служебное имя беседы", () => {
  it("новые и прежние имена показаны по-русски и допускают автоматическое название", () => {
    for (const title of [DEFAULT_WORKSPACE_TITLE, "Untitled Workspace", "Untitled Gadget"]) {
      expect(displayWorkspaceTitle(title)).toBe("Новая беседа");
      expect(isDefaultWorkspaceTitle(title)).toBe(true);
    }
  });
  it("сохраняет пользовательское имя на любом языке", () => {
    for (const title of ["Annual Report", "Мой план", "Untitled Workspace — notes"]) {
      expect(displayWorkspaceTitle(title)).toBe(title);
      expect(isDefaultWorkspaceTitle(title)).toBe(false);
    }
  });
});


describe("название беседы только по-русски", () => {
  it("русское название проходит, кавычки и перенос убираются", () => {
    expect(russianTitle("«Статус проекта Mnemos»\n")).toBe("Статус проекта Mnemos");
    expect(russianTitle("Отчёт для Альфа-Логистик.")).toBe("Отчёт для Альфа-Логистик");
  });
  it("английское название отбрасывается", () => {
    expect(russianTitle("Mnemos Status Gadget")).toBeNull();
    expect(russianTitle("Latest commit in Mnemos repo")).toBeNull();
    expect(russianTitle("")).toBeNull();
  });
});
