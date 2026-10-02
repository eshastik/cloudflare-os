import { describe, expect, it } from "vitest";
import { homePromptFromSearch, homeProjectFromSearch, projectContextFromProjects } from "./homePrompt";
import { MAX_GATEKEEPER_APP_PROMPT_LENGTH } from "./gatekeeperAppNavigation";

describe("homePromptFromSearch", () => {
  it("returns a trimmed prompt for one-time composer seeding", () => {
    expect(homePromptFromSearch("  Build a morning brief.  ")).toBe("Build a morning brief.");
  });

  it("ignores non-text, empty, and oversized search values", () => {
    expect(homePromptFromSearch(42)).toBeUndefined();
    expect(homePromptFromSearch("   ")).toBeUndefined();
    expect(homePromptFromSearch("x".repeat(MAX_GATEKEEPER_APP_PROMPT_LENGTH + 1))).toBeUndefined();
  });
});

it("выбранные материалы сохраняются в контексте проекта, не в тексте запроса", () => {
  const materials = [{ nodeId: "doc-1", name: "Отчёт.pdf" }, { nodeId: "dir-1", name: "Исследования", folder: true }];
  const context = homeProjectFromSearch({ accountId: 0, projectId: "project", title: "Проект", materials });
  expect(projectContextFromProjects(context!.projects!)?.projects?.[0].materials).toEqual(materials);
  expect(homeProjectFromSearch({ accountId: 0, projectId: "project", title: "Проект", materials: [{ nodeId: "../other", name: "Файл" }] })).toBeUndefined();
});
