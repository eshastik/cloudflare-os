import { Buffer } from "node:buffer";
import { Client } from "pg";

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
  constructor(
    private readonly connectionString: string,
    private readonly tenant: string,
    private readonly namespace: "blueprints" | "context-collections",
  ) {
    if (!tenant || tenant.includes("\0")) throw new Error("Неверная область состояния оболочки");
  }

  private async transaction<T>(write: boolean, operation: (client: Client) => Promise<T>): Promise<T> {
    // Worker не может переносить сокет между контекстами запросов. Hyperdrive
    // управляет пулом соединений; один клиент здесь принадлежит одной операции.
    const client = new Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
    });
    let connectionError: Error | undefined;
    // pg сообщает о разрыве также событием EventEmitter вне query Promise.
    // Обработчик сохраняет отказ операции и не допускает необработанного исключения.
    client.on("error", error => { connectionError = error; });
    try {
      await client.connect();
      await client.query(write ? "BEGIN" : "BEGIN READ ONLY");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('statement_timeout','5000',true)", [this.tenant]);
      const result = await operation(client);
      if (connectionError) throw connectionError;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Закрытие соединения завершает транзакцию при отказе связи. */ }
      throw error;
    } finally {
      await client.end();
    }
  }

  async get(key: string): Promise<string | null> {
    return this.transaction(false, async client => {
      const result = await client.query<{ value: Buffer }>(
        "SELECT value FROM mnemos_shell.text_kv WHERE tenant_id=$1 AND namespace=$2 AND key=$3",
        [this.tenant, this.namespace, Buffer.from(key, "utf8")],
      );
      return result.rows[0]?.value.toString("utf8") ?? null;
    });
  }

  async put(key: string, value: string): Promise<void> {
    await this.transaction(true, async client => {
      await client.query(
        "INSERT INTO mnemos_shell.text_kv(tenant_id,namespace,key,value) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,namespace,key) DO UPDATE SET value=EXCLUDED.value",
        [this.tenant, this.namespace, Buffer.from(key, "utf8"), Buffer.from(value, "utf8")],
      );
    });
  }

  async delete(key: string): Promise<void> {
    await this.transaction(true, async client => {
      await client.query(
        "DELETE FROM mnemos_shell.text_kv WHERE tenant_id=$1 AND namespace=$2 AND key=$3",
        [this.tenant, this.namespace, Buffer.from(key, "utf8")],
      );
    });
  }
}
