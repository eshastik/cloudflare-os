import { describe, expect, it, vi } from "vitest";
import { Socket } from "node:net";
const state = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[], queries: [] as string[], ended: 0 }));
vi.mock("pg", () => ({ Client: class {
  constructor(config: Record<string, unknown>) { state.configs.push(config); }
  on() {}
  async connect() {}
  async query(sql: string) { state.queries.push(sql); }
  async end() { state.ended++; }
} }));
import { withPostgresState } from "../src/postgres-state";

describe("соединение PostgreSQL одной операции", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])("освобождает локальный транспорт %s после COMMIT", async host => {
    const before = state.ended;
    const result = await withPostgresState("postgres://u:p@" + host + "/db", "tenant", false, async () => 42);
    expect(result).toBe(42);
    const config = state.configs.at(-1)!;
    const stream = config.stream as () => Socket;
    const socket = stream();
    expect(socket).toBeInstanceOf(Socket);
    socket.destroy();
    expect(state.queries.at(-1)).toBe("COMMIT");
    expect(state.ended).toBe(before + 1);
  });
  it.each(["not-a-url", "postgres://u:p@localhost/db?host=database", "postgres://u:p@database/db", "postgres://u:p@127.0.0.1/db?sslmode=require", "postgres://u:p@localhost/db?ssl=true", "postgres://u:p@localhost/db?sslrootcert=ca.pem"])("сохраняет транспорт с настройками TLS: %s", async dsn => {
    await withPostgresState(dsn, "tenant", false, async () => null);
    expect(state.configs.at(-1)!.stream).toBeUndefined();
  });
  it("закрывает соединение и откатывает неуспешную операцию", async () => {
    const before = state.ended;
    await expect(withPostgresState("postgres://u:p@127.0.0.1/db", "tenant", true, async () => { throw new Error("отказ"); })).rejects.toThrow("отказ");
    expect(state.queries.at(-1)).toBe("ROLLBACK");
    expect(state.ended).toBe(before + 1);
  });
});
