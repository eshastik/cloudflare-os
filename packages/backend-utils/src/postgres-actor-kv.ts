import { Buffer } from "node:buffer";
import { withPostgresState } from "./postgres-state";

/** Состояние личного Telegram-бота. RPC-ссылки и бинарные тела здесь не сохраняются. */
export class PostgresActorKv {
  constructor(
    private readonly connectionString: string,
    private readonly tenant: string,
    private readonly actorType: "telegram-bot" | "telegram-claim",
    private readonly actorId: string,
  ) {
    if (!tenant || tenant.includes("\0") || !/^[0-9a-f]{64}$/.test(actorId)) {
      throw new Error("Неверная область состояния Telegram");
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return withPostgresState(this.connectionString, this.tenant, false, async client => {
      const result = await client.query<{ value: Buffer }>(
        "SELECT value FROM mnemos_shell.actor_kv WHERE tenant_id=$1 AND actor_type=$2 AND actor_id=$3 AND key=$4",
        [this.tenant, this.actorType, this.actorId, Buffer.from(key, "utf8")],
      );
      return result.rows[0] ? JSON.parse(result.rows[0].value.toString("utf8")) as T : undefined;
    });
  }

  async put<T>(key: string, value: T): Promise<void> {
    const json = jsonState(value);
    await withPostgresState(this.connectionString, this.tenant, true, async client => {
      await client.query(
        "INSERT INTO mnemos_shell.actor_kv(tenant_id,actor_type,actor_id,key,value) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,actor_type,actor_id,key) DO UPDATE SET value=EXCLUDED.value",
        [this.tenant, this.actorType, this.actorId, Buffer.from(key, "utf8"), Buffer.from(json, "utf8")],
      );
    });
  }

  async delete(key: string): Promise<boolean> {
    return withPostgresState(this.connectionString, this.tenant, true, async client => {
      const result = await client.query(
        "DELETE FROM mnemos_shell.actor_kv WHERE tenant_id=$1 AND actor_type=$2 AND actor_id=$3 AND key=$4",
        [this.tenant, this.actorType, this.actorId, Buffer.from(key, "utf8")],
      );
      return result.rowCount === 1;
    });
  }

  async list<T>({ prefix }: { prefix: string }): Promise<[string, T][]> {
    return withPostgresState(this.connectionString, this.tenant, false, async client => {
      const result = await client.query<{ key: Buffer; value: Buffer }>(
        "SELECT key,value FROM mnemos_shell.actor_kv WHERE tenant_id=$1 AND actor_type=$2 AND actor_id=$3 AND substring(key from 1 for octet_length($4::bytea))=$4::bytea ORDER BY key",
        [this.tenant, this.actorType, this.actorId, Buffer.from(prefix, "utf8")],
      );
      return result.rows.map(row => [row.key.toString("utf8"), JSON.parse(row.value.toString("utf8")) as T]);
    });
  }

  /** Один Telegram-бот закрепляется за одним владельцем атомарно в базе. */
  async claimOwner(owner: string): Promise<boolean> {
    if (this.actorType !== "telegram-claim" || !owner) throw new Error("Неверное закрепление Telegram-бота");
    return withPostgresState(this.connectionString, this.tenant, true, async client => {
      const result = await client.query(
        "INSERT INTO mnemos_shell.actor_kv(tenant_id,actor_type,actor_id,key,value) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,actor_type,actor_id,key) DO UPDATE SET value=EXCLUDED.value WHERE mnemos_shell.actor_kv.value=EXCLUDED.value RETURNING key",
        [this.tenant, this.actorType, this.actorId, Buffer.from("owner"), Buffer.from(jsonState(owner))],
      );
      return result.rowCount === 1;
    });
  }

  /** Чужой владелец не может освободить закреплённого Telegram-бота. */
  async releaseOwner(owner: string): Promise<void> {
    if (this.actorType !== "telegram-claim" || !owner) throw new Error("Неверное закрепление Telegram-бота");
    await withPostgresState(this.connectionString, this.tenant, true, async client => {
      await client.query(
        "DELETE FROM mnemos_shell.actor_kv WHERE tenant_id=$1 AND actor_type=$2 AND actor_id=$3 AND key=$4 AND value=$5",
        [this.tenant, this.actorType, this.actorId, Buffer.from("owner"), Buffer.from(jsonState(owner))],
      );
    });
  }

  /** Расписание уведомлений хранится вместе с состоянием бота в PostgreSQL. */
  async getAlarm(): Promise<number | null> {
    if (this.actorType !== "telegram-bot") throw new Error("Для этого объекта нет будильника");
    return withPostgresState(this.connectionString, this.tenant, false, async client => {
      const result = await client.query<{ due_at: string }>(
        "SELECT due_at FROM mnemos_shell.actor_alarms WHERE tenant_id=$1 AND actor_type=$2 AND actor_id=$3",
        [this.tenant, this.actorType, this.actorId],
      );
      return result.rows[0] ? Number(result.rows[0].due_at) : null;
    });
  }

  /** Новое расписание заменяет предыдущее; null снимает будильник. */
  async setAlarm(at: number | null): Promise<void> {
    if (this.actorType !== "telegram-bot" || (at !== null && (!Number.isSafeInteger(at) || at < 0 || at > 8_640_000_000_000_000))) {
      throw new Error("Неверное расписание Telegram");
    }
    await withPostgresState(this.connectionString, this.tenant, true, async client => {
      if (at === null) {
        await client.query(
          "DELETE FROM mnemos_shell.actor_alarms WHERE tenant_id=$1 AND actor_type=$2 AND actor_id=$3",
          [this.tenant, this.actorType, this.actorId],
        );
      } else {
        await client.query(
          "INSERT INTO mnemos_shell.actor_alarms(tenant_id,actor_type,actor_id,due_at) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,actor_type,actor_id) DO UPDATE SET due_at=EXCLUDED.due_at,lease_until=0,lease_token=NULL",
          [this.tenant, this.actorType, this.actorId, at],
        );
      }
    });
  }
}

/** Отказ вместо молчаливой потери специальных значений при JSON-сериализации. */
export function jsonState(value: unknown): string {
  const active = new Set<object>();
  const validate = (item: unknown): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || active.has(item)) throw new Error("Состояние Telegram должно быть JSON");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new Error("Состояние Telegram должно быть JSON");
    }
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === "length") continue;
      if (typeof key !== "string" || !descriptors[key].enumerable || !("value" in descriptors[key])) {
        throw new Error("Состояние Telegram должно быть JSON");
      }
      if (Array.isArray(item) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) {
        throw new Error("Состояние Telegram должно быть JSON");
      }
      validate(descriptors[key].value);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) {
      throw new Error("Состояние Telegram должно быть JSON");
    }
    active.delete(item);
  };
  validate(value);
  return JSON.stringify(value);
}
