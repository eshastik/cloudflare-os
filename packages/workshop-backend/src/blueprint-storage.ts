import { textKv, type PostgresStateEnv, type TextKv } from "@gadgets/backend-utils/postgres-text-kv";

/** Каталог шаблонов хранит JSON; содержимое файлов остаётся в объектном хранилище. */
export function blueprintStorage(env: PostgresStateEnv & { BLUEPRINTS: TextKv }): TextKv {
  return textKv(env, "blueprints", env.BLUEPRINTS);
}
