import { describe, expect, it } from "vitest";
import { SLOW_RPC_MS, timeRpcMethods } from "../src/rpc-timing";

describe("timeRpcMethods", () => {
  it("пишет только долгие вызовы: имя метода и миллисекунды, без аргументов", async () => {
    let clock = 0;
    const lines: unknown[][] = [];
    let release!: () => void;
    class Api {
      secret = "k";
      quick(token: string) { return token.length; }
      async slow(_token: string) { await new Promise<void>(resolve => { release = resolve; }); return this.secret; }
      async broken() { clock += SLOW_RPC_MS + 5; throw new Error("нет"); }
      get prop() { return 1; }
    }
    timeRpcMethods(Api, "api", (...line) => lines.push(line), () => clock);
    const api = new Api();
    expect(api.quick("session-token")).toBe(13);
    const pending = api.slow("session-token");
    clock += 350;
    release();
    expect(await pending).toBe("k");
    await expect(api.broken()).rejects.toThrow("нет");
    await Promise.resolve();
    expect(api.prop).toBe(1);
    expect(lines).toEqual([["api.slow", 350, "ok"], ["api.broken", SLOW_RPC_MS + 5, "error"]]);
    expect(JSON.stringify(lines)).not.toContain("session-token");
  });

  it("вызов короче порога не пишется", async () => {
    let clock = 0;
    const lines: unknown[] = [];
    class Api { async fast() { clock += SLOW_RPC_MS - 1; } }
    timeRpcMethods(Api, "api", (...line) => lines.push(line), () => clock);
    await new Api().fast();
    await Promise.resolve();
    expect(lines).toEqual([]);
  });
});
