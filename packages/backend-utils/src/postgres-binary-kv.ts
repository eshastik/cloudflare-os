import { Buffer } from "node:buffer";
import { withPostgresState } from "./postgres-state";

/** Небольшие бинарные значения платформы; файлы проектов продолжают храниться в S3. */
export class PostgresBinaryKv {
  constructor(
    private readonly connectionString: string,
    private readonly tenant: string,
    private readonly namespace: "blueprints" | "context-collections" | "avatars",
  ) {
    if (!tenant || tenant.includes("\0")) throw new Error("Неверная область состояния оболочки");
  }

  async get(key: string): Promise<Uint8Array | null> {
    return withPostgresState(this.connectionString, this.tenant, false, async client => {
      const result = await client.query<{ value: Buffer }>(
        "SELECT value FROM mnemos_shell.text_kv WHERE tenant_id=$1 AND namespace=$2 AND key=$3",
        [this.tenant, this.namespace, Buffer.from(key, "utf8")],
      );
      return result.rows[0] ? new Uint8Array(result.rows[0].value) : null;
    });
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    await withPostgresState(this.connectionString, this.tenant, true, async client => {
      await client.query(
        "INSERT INTO mnemos_shell.text_kv(tenant_id,namespace,key,value) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,namespace,key) DO UPDATE SET value=EXCLUDED.value",
        [this.tenant, this.namespace, Buffer.from(key, "utf8"), Buffer.from(value)],
      );
    });
  }

  async delete(key: string): Promise<void> {
    await withPostgresState(this.connectionString, this.tenant, true, async client => {
      await client.query(
        "DELETE FROM mnemos_shell.text_kv WHERE tenant_id=$1 AND namespace=$2 AND key=$3",
        [this.tenant, this.namespace, Buffer.from(key, "utf8")],
      );
    });
  }
}
