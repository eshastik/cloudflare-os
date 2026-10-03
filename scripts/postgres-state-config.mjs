/** Добавляет приватную PostgreSQL-привязку доверенному Worker, не записывая пароль в конфигурацию. */
export function configurePostgresState(config, env) {
  if (env.SHELL_STATE_BACKEND === undefined) return;
  const localDsn = env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_SHELL_POSTGRES;
  if (env.SHELL_STATE_BACKEND !== "postgres" || !env.SHELL_STATE_TENANT || !localDsn) {
    throw new Error("Не настроено PostgreSQL-хранилище оболочки");
  }
  let parsed;
  try { parsed = new URL(localDsn); } catch { throw new Error("Неверная строка подключения PostgreSQL оболочки"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error("Неверная строка подключения PostgreSQL оболочки");
  }
  config.vars = { ...config.vars, SHELL_STATE_BACKEND: "postgres", SHELL_STATE_TENANT: env.SHELL_STATE_TENANT };
  config.hyperdrive = [
    ...(config.hyperdrive ?? []).filter(binding => binding.binding !== "SHELL_POSTGRES"),
    // Wrangler читает DSN из CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_…
    // в окружении процесса. Пароль не попадает в wrangler.dev.jsonc или vars.
    { binding: "SHELL_POSTGRES", id: "00000000000000000000000000000000" },
  ];
}
