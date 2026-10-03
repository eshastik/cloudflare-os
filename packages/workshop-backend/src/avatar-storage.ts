import { PostgresBinaryKv } from "@gadgets/backend-utils/postgres-binary-kv";
import type { PostgresStateEnv } from "@gadgets/backend-utils/postgres-text-kv";

/** Поэтапное переключение изображений профиля на PostgreSQL. */
export interface AvatarStateEnv extends PostgresStateEnv {
  SHELL_AVATAR_STATE_BACKEND?: string;
}

/** Изображения профиля: запись подтверждается до ответа человеку. */
export interface AvatarStorage {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Включённый PostgreSQL не возвращается к KV при сбое или неверной конфигурации. */
export function avatarStorage(env: AvatarStateEnv, legacy: KVNamespace): AvatarStorage {
  if (env.SHELL_AVATAR_STATE_BACKEND === undefined) {
    return {
      get: async key => {
        const bytes = await legacy.get(key, "arrayBuffer");
        return bytes === null ? null : new Uint8Array(bytes);
      },
      put: (key, value) => legacy.put(key, value),
      delete: key => legacy.delete(key),
    };
  }
  if (env.SHELL_AVATAR_STATE_BACKEND !== "postgres" || env.SHELL_STATE_BACKEND !== "postgres"
      || !env.SHELL_POSTGRES || !env.SHELL_STATE_TENANT) {
    throw new Error("Не настроено PostgreSQL-хранилище изображений профиля");
  }
  return new PostgresBinaryKv(env.SHELL_POSTGRES.connectionString, env.SHELL_STATE_TENANT, "avatars");
}
