import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { configureLocalObservabilityEnvironment, getWranglerPortFromBackendHost } from "./dev-server-config.js";

describe("getWranglerPortFromBackendHost", () => {
  it("extracts a port from a localhost backend host", () => {
    assert.equal(getWranglerPortFromBackendHost("localhost:9000"), "9000");
  });

  it("extracts a port from an IPv6 backend host", () => {
    assert.equal(getWranglerPortFromBackendHost("[::1]:9001"), "9001");
  });

  it("returns null when the backend host has no port", () => {
    assert.equal(getWranglerPortFromBackendHost("localhost"), null);
  });

  it("rejects invalid ports", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("localhost:99999"),
        /VITE_BACKEND_HOST must include a valid port/);
  });

  it("rejects invalid IPv6 ports", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("[::1]:99999"),
        /VITE_BACKEND_HOST must include a valid port/);
  });

  it("rejects port zero", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("localhost:0"),
        /VITE_BACKEND_HOST must include a valid port/);
  });

  it("rejects invalid hosts", () => {
    assert.throws(
        () => getWranglerPortFromBackendHost("http://localhost:9000"),
        /VITE_BACKEND_HOST must include a valid host/);
  });
});

describe("локальная отладочная телеметрия", () => {
  it("передаёт выбор установки в переключатель Wrangler", () => {
    for (const value of ["false", "true"]) {
      const env = { SHELL_LOCAL_OBSERVABILITY: value, X_LOCAL_OBSERVABILITY: value === "true" ? "false" : "true", OTHER: "unchanged" };
      configureLocalObservabilityEnvironment(env);
      assert.equal(env.X_LOCAL_OBSERVABILITY, value);
      assert.equal(env.OTHER, "unchanged");
    }
  });
  it("постоянный сервер отключает сбор по умолчанию и допускает явную отладку", () => {
    const env = {};
    configureLocalObservabilityEnvironment(env, { persistentServer: true });
    assert.equal(env.X_LOCAL_OBSERVABILITY, "false");
    const debug = { SHELL_LOCAL_OBSERVABILITY: "true" };
    configureLocalObservabilityEnvironment(debug, { persistentServer: true });
    assert.equal(debug.X_LOCAL_OBSERVABILITY, "true");
  });
  it("без настройки сохраняет режим разработчика", () => {
    const env = { X_LOCAL_OBSERVABILITY: "true" };
    configureLocalObservabilityEnvironment(env);
    assert.deepEqual(env, { X_LOCAL_OBSERVABILITY: "true" });
  });
  it("отвергает опечатку настройки", () => {
    assert.throws(() => configureLocalObservabilityEnvironment({ SHELL_LOCAL_OBSERVABILITY: "off" }));
  });
});

it("закреплённый Wrangler использует отдельный переключатель локального сборщика", () => {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("wrangler/package.json"));
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "4.119.0");
  const source = readFileSync(join(root, "wrangler-dist/cli.js"), "utf8");
  assert.match(source, /variableName: "X_LOCAL_OBSERVABILITY"/);
  assert.match(source, /unsafeObservability: getLocalObservabilityEnabledFromEnv\(\)/);
});
