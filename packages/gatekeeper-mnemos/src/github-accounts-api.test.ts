import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";

const TICKET = "T"+"k".repeat(42);

test("аккаунты GitHub: пути, разбор ответа и отказ негодных номеров до сети", async () => {
  const calls: string[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    const u = new URL(String(url));
    calls.push(`${init?.method} ${u.pathname}`);
    if (u.pathname === "/v1/git/app/connect") return Response.json({ ticket: TICKET, start: "/v1/git/app/start" });
    if (u.pathname === "/v1/git/app/accounts") return Response.json({ available: true, connectable: true, accounts: [
      { installation_id: "11", github_login: "alice", account_login: "alice", account_type: "User", repository_selection: "all", linked_at: "2026-09-24T12:00:00Z", repository_count: 3, manage_url: "https://github.com/settings/installations/11" },
      { installation_id: "12", github_login: "alice-work", account_login: "acme", account_type: "Organization", repository_selection: "selected", access_stale: true },
    ] });
    return Response.json({ disconnected: true });
  });
  assert.deepEqual(await api.startGitHubConnect(), { ticket: TICKET });
  const page = await api.listGitHubAccounts();
  assert.equal(page.accounts.length, 2);
  assert.equal(page.accounts[1].repository_count, -1);
  assert.equal(page.accounts[1].manage_url, "");
  assert.equal(page.accounts[0].access_stale, false);
  assert.equal(page.accounts[1].access_stale, true);
  await api.disconnectGitHubAccount("12");
  assert.throws(() => api.disconnectGitHubAccount("../12"), MnemosAPIError);
  assert.throws(() => api.disconnectGitHubAccount("0"), MnemosAPIError);
  assert.deepEqual(calls, ["POST /v1/git/app/connect", "GET /v1/git/app/accounts", "DELETE /v1/git/app/accounts/12"]);
});

test("негодные ответы об аккаунтах GitHub отвергаются", async () => {
  const answer = (body: unknown) => new MnemosAPI("https://memory.example", async () => "human", async () => Response.json(body));
  // Прежний ответ с адресом GitHub и билет не по шаблону не принимаются.
  for (const body of [{ url: "https://github.com/login/oauth/authorize?state=abc" }, { ticket: TICKET.slice(1) }, { ticket: TICKET.slice(1) + "/" }, { ticket: 42 }]) {
    await assert.rejects(answer(body).startGitHubConnect(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502, JSON.stringify(body));
  }
  await assert.rejects(answer({ available: true, accounts: [] }).listGitHubAccounts(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
  await assert.rejects(answer({ available: true, connectable: true, accounts: [{ installation_id: "x", github_login: "a", account_login: "a" }] }).listGitHubAccounts(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
});
