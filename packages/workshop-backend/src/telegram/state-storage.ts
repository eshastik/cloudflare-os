import { PostgresActorKv } from "@gadgets/backend-utils/postgres-actor-kv";
import type { PostgresStateEnv } from "@gadgets/backend-utils/postgres-text-kv";
import type { PersonalBotStorage } from "./personal-bot";

/** После переноса старый объект не может снова писать в SQLite. */
export const TELEGRAM_RETIRED_KEY = "_mnemos_postgres_retired";

/** Приватный переключатель отдельного этапа переноса Telegram. */
export interface TelegramStateEnv extends PostgresStateEnv {
  SHELL_TELEGRAM_STATE_BACKEND?: string;
}

/** Поэтапный выбор хранилища; при отказе PostgreSQL возврата к SQLite нет. */
export function telegramStorage(
  env: TelegramStateEnv,
  actorType: "telegram-bot" | "telegram-claim",
  actorId: string,
  legacy: SyncKvStorage,
): PostgresActorKv | LegacyTelegramStorage {
  if (env.SHELL_TELEGRAM_STATE_BACKEND === undefined) return new LegacyTelegramStorage(legacy);
  if (env.SHELL_TELEGRAM_STATE_BACKEND !== "postgres" || env.SHELL_STATE_BACKEND !== "postgres" || !env.SHELL_POSTGRES || !env.SHELL_STATE_TENANT) {
    throw new Error("Не настроено PostgreSQL-хранилище Telegram");
  }
  return new PostgresActorKv(env.SHELL_POSTGRES.connectionString, env.SHELL_STATE_TENANT, actorType, actorId);
}

/** Старое хранилище допускается до переноса, затем отказывает даже на чтении. */
export class LegacyTelegramStorage implements PersonalBotStorage {
  constructor(private readonly storage: SyncKvStorage) {}

  private check(): void {
    if (this.storage.get<boolean>(TELEGRAM_RETIRED_KEY)) throw new Error("Состояние Telegram уже перенесено в PostgreSQL");
  }

  get<T>(key: string): T | undefined { this.check(); return this.storage.get<T>(key); }
  put<T>(key: string, value: T): void { this.check(); this.storage.put(key, value); }
  delete(key: string): boolean { this.check(); return this.storage.delete(key); }
  list<T>(options: { prefix: string }): Iterable<[string, T]> { this.check(); return this.storage.list<T>(options); }
}

/** Будильники нового состояния не обращаются к SQLite-будильникам Worker. */
export function telegramAlarms(env: TelegramStateEnv, ctx: DurableObjectState): {
  getAlarm(): Promise<number | null>;
  setAlarm(at: number | null): Promise<void>;
} {
  const storage = telegramStorage(env, "telegram-bot", ctx.id.toString(), ctx.storage.kv);
  if (storage instanceof PostgresActorKv) return storage;
  return {
    getAlarm: async () => {
      storage.get("bot");
      return ctx.storage.getAlarm();
    },
    setAlarm: async at => {
      storage.get("bot");
      if (at === null) await ctx.storage.deleteAlarm();
      else await ctx.storage.setAlarm(at);
    },
  };
}
