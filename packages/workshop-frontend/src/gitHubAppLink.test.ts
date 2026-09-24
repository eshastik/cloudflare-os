import { describe, expect, it } from "vitest";
import { isGitHubAppPage, readGitHubReturn } from "./gitHubAppLink";

describe("страницы GitHub, которые фрейм может открыть", () => {
  it("пускает установку приложения и настройки установки", () => {
    expect(isGitHubAppPage("https://github.com/apps/mnemos-app/installations/new?state=abc_DEF-1")).toBe(true);
    expect(isGitHubAppPage("https://github.com/apps/mnemos-app/installations/new")).toBe(true);
    expect(isGitHubAppPage("https://github.com/settings/installations/123456")).toBe(true);
    expect(isGitHubAppPage("https://github.com/organizations/acme-co/settings/installations/42")).toBe(true);
  });

  it("пускает вход в приложение GitHub с номером клиента и state", () => {
    expect(isGitHubAppPage("https://github.com/login/oauth/authorize?client_id=Iv23liAbC.1&prompt=select_account&state=abcDEF0123456789_-xyz")).toBe(true);
    expect(isGitHubAppPage("https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=abcDEF0123456789")).toBe(true);
  });

  it("не пускает вход без state, чужого вида клиента и с лишними параметрами", () => {
    for (const url of [
      "https://github.com/login/oauth/authorize?client_id=Iv1.abc",
      "https://github.com/login/oauth/authorize?state=abcDEF0123456789",
      "https://github.com/login/oauth/authorize?client_id=Ov23liAbC&state=abcDEF0123456789",
      "https://github.com/login/oauth/authorize?client_id=0123456789abcdef0123&state=abcDEF0123456789",
      "https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=abcDEF0123456789&redirect_uri=https://evil.ru/",
      "https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=abcDEF0123456789&scope=repo",
      "https://github.com/login/oauth/authorize?client_id=Iv1.abc&client_id=Iv1.def&state=abcDEF0123456789",
      "https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=short",
      "https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=abcDEF0123456789&prompt=consent",
      "https://github.com/login/oauth/access_token?client_id=Iv1.abc&state=abcDEF0123456789",
      "https://github.com/organizations/acme/settings/installations/abc",
      "https://github.com/organizations/acme/settings/profile",
    ]) expect(isGitHubAppPage(url), url).toBe(false);
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
