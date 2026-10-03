import { Buffer } from "node:buffer";
import { PostgresBinaryKv } from "./postgres-binary-kv";

/** Текстовые каталоги платформы. Не принимает тела файлов или исполняемые RPC-ссылки. */
export interface TextKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Приватная привязка базы доступна только доверенным Worker платформы. */
export interface PostgresStateEnv {
  SHELL_STATE_BACKEND?: string;
  SHELL_STATE_TENANT?: string;
  SHELL_POSTGRES?: Pick<Hyperdrive, "connectionString">;
}

/** Выбор хранилища при поэтапном переносе; неверная PostgreSQL-конфигурация отказывает явно. */
export function textKv(
  env: PostgresStateEnv,
  namespace: "blueprints" | "context-collections",
  legacy: TextKv,
): TextKv {
  if (env.SHELL_STATE_BACKEND === undefined) return legacy;
  if (env.SHELL_STATE_BACKEND !== "postgres" || !env.SHELL_POSTGRES || !env.SHELL_STATE_TENANT) {
    throw new Error("Не настроено PostgreSQL-хранилище оболочки");
  }
  return new PostgresTextKv(env.SHELL_POSTGRES.connectionString, env.SHELL_STATE_TENANT, namespace);
}

/** Каждая операция подтверждается COMMIT до ответа. В памяти процесса нет постоянного кэша. */
export class PostgresTextKv implements TextKv {
  readonly #bytes: PostgresBinaryKv;

  constructor(connectionString: string, tenant: string, namespace: "blueprints" | "context-collections") {
    this.#bytes = new PostgresBinaryKv(connectionString, tenant, namespace);
  }

  async get(key: string): Promise<string | null> {
    const bytes = await this.#bytes.get(key);
    return bytes === null ? null : Buffer.from(bytes).toString("utf8");
  }

  async put(key: string, value: string): Promise<void> {
    await this.#bytes.put(key, Buffer.from(value, "utf8"));
  }

  async delete(key: string): Promise<void> {
    await this.#bytes.delete(key);
  }
}
