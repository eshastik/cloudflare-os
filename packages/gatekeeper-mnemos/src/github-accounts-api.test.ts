import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";

test("аккаунты GitHub: пути, разбор ответа и отказ негодных номеров до сети", async () => {
  const calls: string[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    const u = new URL(String(url));
    calls.push(`${init?.method} ${u.pathname}`);
    if (u.pathname === "/v1/git/app/connect") return Response.json({ url: "https://github.com/apps/mnemos/installations/new?state=abc" });
    if (u.pathname === "/v1/git/app/accounts") return Response.json({ available: true, connectable: true, accounts: [
      { installation_id: "11", github_login: "alice", account_login: "alice", account_type: "User", repository_selection: "all", linked_at: "2026-09-24T12:00:00Z", repository_count: 3, manage_url: "https://github.com/settings/installations/11" },
      { installation_id: "12", github_login: "alice-work", account_login: "acme", account_type: "Organization", repository_selection: "selected" },
    ] });
    return Response.json({ disconnected: true });
  });
  assert.equal((await api.startGitHubConnect()).url, "https://github.com/apps/mnemos/installations/new?state=abc");
  const page = await api.listGitHubAccounts();
  assert.equal(page.accounts.length, 2);
  assert.equal(page.accounts[1].repository_count, -1);
  assert.equal(page.accounts[1].manage_url, "");
  await api.disconnectGitHubAccount("12");
  assert.throws(() => api.disconnectGitHubAccount("../12"), MnemosAPIError);
  assert.throws(() => api.disconnectGitHubAccount("0"), MnemosAPIError);
  assert.deepEqual(calls, ["POST /v1/git/app/connect", "GET /v1/git/app/accounts", "DELETE /v1/git/app/accounts/12"]);
});

test("негодные ответы об аккаунтах GitHub отвергаются", async () => {
  const answer = (body: unknown) => new MnemosAPI("https://memory.example", async () => "human", async () => Response.json(body));
  await assert.rejects(answer({ url: "http://github.com/x" }).startGitHubConnect(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
  await assert.rejects(answer({ available: true, accounts: [] }).listGitHubAccounts(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
  await assert.rejects(answer({ available: true, connectable: true, accounts: [{ installation_id: "x", github_login: "a", account_login: "a" }] }).listGitHubAccounts(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
});
