import { Client } from "pg";
import { Socket } from "node:net";

function plaintextConnection(connectionString: string): boolean {
  let address: URL;
  try { address = new URL(connectionString); } catch { return false; }
  const sslmode = address.searchParams.get("sslmode");
  return (sslmode === "disable" || sslmode === null && ["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
    && address.searchParams.getAll("sslmode").length <= 1
    && [...address.searchParams.keys()].every(key => (key === "sslmode" || !key.toLowerCase().startsWith("ssl")) && key !== "host")
    && !process.env.PGSSLMODE;
}

/** Соединение принадлежит одной операции Worker; её запись подтверждается до ответа. */
export async function withPostgresState<T>(
  connectionString: string, tenant: string, write: boolean, operation: (client: Client) => Promise<T>,
): Promise<T> {
    // Worker не может переносить сокет между контекстами запросов. Hyperdrive
    // управляет пулом соединений; один клиент здесь принадлежит одной операции.
    const client = new Client({
      connectionString: connectionString,
      // pg-cloudflare удерживает закрытые сокеты в долгоживущем workerd.
      // TCP без TLS идёт через Node, включая локальную привязку Hyperdrive.
      // Запрошенное шифрование сохраняет прежний транспорт.
      ...(plaintextConnection(connectionString) ? { stream: () => new Socket() } : {}),
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
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('statement_timeout','5000',true)", [tenant]);
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
