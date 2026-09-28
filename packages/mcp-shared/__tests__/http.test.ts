import { describe, expect, it } from "vitest";

import { handleMcpHttpRequest } from "../src/http.js";

const DO_ID = "a".repeat(64);
const NONCE = "b".repeat(64);
const log = { warn() {} } as never;

function request(path: string, method = "GET") {
  return new Request(`https://workshop.example/gatekeeper/mcp${path}`, { method });
}

describe("handleMcpHttpRequest", () => {
  it.each([
    ["/elsewhere", 404],
    [`/gatekeeper/mcp/${DO_ID}/short`, 404],
    [`/gatekeeper/mcp/${"x".repeat(64)}/${NONCE}`, 400],
  ])("returns the expected status for %s", async (path, status) => {
    const response = await handleMcpHttpRequest(
      new Request(`https://workshop.example${path}`),
      {
        baseUrl: "https://workshop.example/gatekeeper/mcp",
        accountForId(id) {
          if (id !== DO_ID) throw new Error("invalid id");
          return { acceptAuthCode: async () => false as const };
        },
        log,
        connect: async () => new Response("connected"),
      },
    );

    expect(response.status).toBe(status);
  });

  it("delegates a valid connect link without imposing connector method policy", async () => {
    const response = await handleMcpHttpRequest(request(`/${DO_ID}/${NONCE}`, "POST"), {
      baseUrl: "https://workshop.example/gatekeeper/mcp",
      accountForId: () => ({ acceptAuthCode: async () => false as const }),
      log,
      connect: async (req, _account, nonce, path) =>
        Response.json({ method: req.method, nonce, path }),
    });

    expect(await response.json()).toEqual({
      method: "POST",
      nonce: NONCE,
      path: `/gatekeeper/mcp/${DO_ID}/${NONCE}`,
    });
  });

  it("passes the shell's browser cookie to the account and sends the browser back to the shell", async () => {
    const returnPath = `/api/connect/finish?handle=${"1".repeat(64)}.${"2".repeat(32)}.${"H".repeat(43)}`;
    const seen: unknown[] = [];
    const response = await handleMcpHttpRequest(
      new Request(`https://workshop.example/gatekeeper/mcp/oauth?code=code&state=${DO_ID}:${NONCE}`, {
        headers: { Cookie: `__Host-os-connect=${"1".repeat(64)}.${"2".repeat(32)}.${"3".repeat(64)}; unrelated=secret` },
      }),
      {
        baseUrl: "https://workshop.example/gatekeeper/mcp",
        accountForId: () => ({ acceptAuthCode: async (_c: string, _n: string, _i?: string, proof?: unknown) => { seen.push(proof); return returnPath; } }),
        log,
        connect: async () => new Response("unexpected"),
      },
    );

    expect(seen).toEqual([{ connect: `${"1".repeat(64)}.${"2".repeat(32)}.${"3".repeat(64)}` }]);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(returnPath);
  });

  it("a browser the shell did not confirm gets the invalid-link page", async () => {
    const response = await handleMcpHttpRequest(
      request(`/oauth?code=code&state=${DO_ID}:${NONCE}`),
      {
        baseUrl: "https://workshop.example/gatekeeper/mcp",
        accountForId: () => ({ acceptAuthCode: async () => false as const }),
        log,
        connect: async () => new Response("unexpected"),
      },
    );
    expect(response.status).toBe(400);
  });
});
