export function getWranglerPortFromBackendHost(backendHost) {
  const trimmed = backendHost.trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) {
    throw new Error("VITE_BACKEND_HOST must include a valid host with an optional port.");
  }

  let url;
  try {
    url = new URL(`http://${trimmed}`);
  } catch {
    if (/(^.*\]:|^[^:]+:)[^:]+$/.test(trimmed)) {
      throw new Error("VITE_BACKEND_HOST must include a valid port between 1 and 65535.");
    }
    throw new Error("VITE_BACKEND_HOST must include a valid host with an optional port.");
  }

  if (!url.port) return null;

  const port = Number(url.port);
  if (port < 1) {
    throw new Error("VITE_BACKEND_HOST must include a valid port between 1 and 65535.");
  }

  return url.port;
}

// Локальный сборщик Miniflare не учитывает observability из Worker-конфига.
// Перевод настройки установки в отдельный переключатель Wrangler держится пином
// версии и проверкой реального запуска без trace-store.
export function configureLocalObservabilityEnvironment(env, { persistentServer = false } = {}) {
  const value = env.SHELL_LOCAL_OBSERVABILITY ?? (persistentServer ? "false" : undefined);
  if (value === undefined) return;
  if (value !== "false" && value !== "true") throw new Error("SHELL_LOCAL_OBSERVABILITY должен быть true или false");
  env.X_LOCAL_OBSERVABILITY = value;
}
