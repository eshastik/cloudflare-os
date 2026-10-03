import { Client } from "pg";

/** Соединение принадлежит одной операции Worker; её запись подтверждается до ответа. */
export async function withPostgresState<T>(
  connectionString: string, tenant: string, write: boolean, operation: (client: Client) => Promise<T>,
): Promise<T> {
    // Worker не может переносить сокет между контекстами запросов. Hyperdrive
    // управляет пулом соединений; один клиент здесь принадлежит одной операции.
    const client = new Client({
      connectionString: connectionString,
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
