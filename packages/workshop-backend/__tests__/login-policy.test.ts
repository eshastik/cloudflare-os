import { describe, expect, it } from "vitest";
import { gatekeeperLoginPolicy, MNEMOS_VENDOR_ID } from "../src/auth/login-policy.js";
import { getAuthGatekeeperAllowlist, isPasswordAuthEnabled } from "../src/auth/config.js";

describe("вход в оболочку через гейткипер", () => {
  it("Mnemos подключается сразу и заводит сотрудника даже при закрытой регистрации", () => {
    for (const signups of [true, false]) {
      expect(gatekeeperLoginPolicy(MNEMOS_VENDOR_ID, signups)).toEqual({ scopes: "full", persistConnection: true, allowCreate: true });
    }
  });

  it("обычный гейткипер только подтверждает почту и подчиняется флагу регистрации", () => {
    expect(gatekeeperLoginPolicy("google", false)).toEqual({ scopes: "auth", persistConnection: false, allowCreate: false });
    expect(gatekeeperLoginPolicy("google", true).allowCreate).toBe(true);
    expect(gatekeeperLoginPolicy("cloudflare", false)).toEqual({ scopes: "full", persistConnection: true, allowCreate: false });
  });

  it("установка Mnemos: вход только через Mnemos, пароль оболочки выключен, пока его не вернули для аварийного доступа", () => {
    const env = { AUTH_GATEKEEPERS: "mnemos", DISABLE_PASSWORD_AUTH: "true" } as unknown as Cloudflare.Env;
    expect(getAuthGatekeeperAllowlist(env)).toEqual(["mnemos"]);
    expect(isPasswordAuthEnabled(env)).toBe(false);
    expect(isPasswordAuthEnabled({ ...env, DISABLE_PASSWORD_AUTH: "false" } as unknown as Cloudflare.Env)).toBe(true);
    // Без разрешённого гейткипера пароль не выключается: иначе в установку не войти никому.
    expect(isPasswordAuthEnabled({ DISABLE_PASSWORD_AUTH: "true" } as unknown as Cloudflare.Env)).toBe(true);
  });
});
