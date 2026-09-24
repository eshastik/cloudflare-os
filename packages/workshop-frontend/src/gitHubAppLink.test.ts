import { describe, expect, it } from "vitest";
import { isGitHubAppPage, readGitHubReturn } from "./gitHubAppLink";

describe("страницы GitHub, которые фрейм может открыть", () => {
  it("пускает установку приложения и настройки установки", () => {
    expect(isGitHubAppPage("https://github.com/apps/mnemos-app/installations/new?state=abc_DEF-1")).toBe(true);
    expect(isGitHubAppPage("https://github.com/apps/mnemos-app/installations/new")).toBe(true);
    expect(isGitHubAppPage("https://github.com/settings/installations/123456")).toBe(true);
  });

  it("не пускает всё остальное", () => {
    for (const url of [
      "http://github.com/apps/mnemos/installations/new",
      "https://github.com.evil.ru/apps/mnemos/installations/new",
      "https://evil.ru/apps/mnemos/installations/new",
      "https://user:pass@github.com/apps/mnemos/installations/new",
      "https://github.com:8443/apps/mnemos/installations/new",
      "https://github.com/login/oauth/authorize?client_id=x",
      "https://github.com/apps/mnemos/installations/new/../../../evil",
      "https://github.com/settings/tokens",
      "https://github.com/settings/installations/abc",
      "javascript:alert(1)",
      "",
      42,
    ]) expect(isGitHubAppPage(url), String(url)).toBe(false);
  });
});

describe("итог возврата с GitHub", () => {
  it("читает итог и причину без лишнего", () => {
    expect(readGitHubReturn("?section=connections&github=connected")).toEqual({ result: "connected", reason: "" });
    expect(readGitHubReturn("?github=failed&github_error=state")).toEqual({ result: "failed", reason: "state" });
    expect(readGitHubReturn("?github=failed&github_error=<script>")).toEqual({ result: "failed", reason: "" });
    expect(readGitHubReturn("?github=hacked")).toBeNull();
    expect(readGitHubReturn("?section=connections")).toBeNull();
  });
});
