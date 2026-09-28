import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

const EXPECTED_OPEN_ERROR_CODES = new Set([
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_ACCESS_DENIED",
  // Отказ обмена кода входа (повтор, чужой браузер, чужая страница).
  "LOGIN_CODE_REJECTED",
  "CONNECT_CODE_REJECTED",
  // Отказ подключения личного бота Telegram (нет ключа шифрования, неверный токен).
  "TELEGRAM_SETUP_REJECTED",
]);

export default defineConfig({
  esbuild: {
    target: "es2022",
  },
  plugins: [
    capnwebValidate(),
    cloudflareTest({
      main: "./src/server.ts",
      remoteBindings: false,
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      // Личный бот Telegram: ключ шифрования токенов и публичный адрес вебхука — только тестовые.
      miniflare: {
        bindings: {
          SHELL_SECRETS_KEY: "integration-test-shell-secrets-key-0123456789",
          PUBLIC_BASE_URL: "https://workshop.invalid",
        },
      },
    }),
  ],
  test: {
    include: ["__integration__/*.test.ts"],
    // Whichever test runs first pays for workerd booting and instantiating the whole backend
    // bundle -- ~6s on a dev machine and roughly 3x that on a CI runner, while every subsequent
    // test in the file finishes in tens of milliseconds. The timeout has to clear that cold
    // start, not the steady-state cost, or the first test fails wherever the runner is slow.
    testTimeout: 60_000,
    // A rejected future capability is reported independently from the awaited pipelined call.
    // The tests assert these exact rejections; all unrelated unhandled errors remain fatal.
    onUnhandledError(error) {
      const code = "code" in error ? error.code : undefined;
      if (typeof code === "string" && EXPECTED_OPEN_ERROR_CODES.has(code)) return false;
    },
  },
});
