// Sign-in via authentication gatekeepers.
//
// Unlike the normal connect-account flow (which runs for an already-logged-in user), login happens
// before we know who the user is. Вход идёт переходами в одной вкладке (см. login-return.ts):
//
//   1. GET /api/login/start заводит PendingLogin DO, отдаёт гейткиперу LoginConnectCallbackImpl и
//      путь возврата /api/login/finish и уводит браузер к гейткиперу.
//   2. When the gatekeeper finishes, it calls LoginConnectCallbackImpl.complete(user). We read the
//      verified email, resolve/create the email-keyed user DO, mint a session, and deliver the token
//      to the PendingLogin DO.
//   3. /api/login/finish выдаёт одноразовый код, приложение меняет его на ключ сеанса по RPC.
//
// Sign-in only requests minimal scopes and the gatekeeper grant is transient (it self-destructs
// shortly after we read the email) — so login does NOT create a persistent connected account.
// Capability access (repos, docs, billing) is granted later when the user explicitly connects the
// gatekeeper, which requests the full scopes and persists the connection.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { GatekeeperConnectCallback, GatekeeperUser } from "@gadgets/workshop-shared/gatekeeper";
import { createWorkshopLogger } from "../observability";
import { gatekeeperLoginPolicy } from "./login-policy.js";
import { readAdminConfig } from "../admin-config.js";
import { shellLoginTarget } from "./login-aliases.js";
import { PendingLoginState, confirmLoginBrowser, type LoginFailure } from "./login-return.js";
import type { ShellBrowserProof } from "@gadgets/workshop-shared/shell-browser";
import type { UserDurableObject } from "../user.js";

const logger = createWorkshopLogger("workshop.auth");

// Один вход через гейткипер: хеш секрета браузера, путь возврата, ключ сеанса до обмена и хеш
// одноразового кода. По будильнику на сроке входа всё стирается.
export class PendingLogin extends DurableObject<Cloudflare.Env> {
  #state = new PendingLoginState(this.ctx.storage.kv, () => Date.now());

  async begin(secretHash: string, returnTo: string): Promise<number> {
    const deadline = await this.#state.begin(secretHash, returnTo);
    await this.ctx.storage.setAlarm(deadline);
    return deadline;
  }
  async confirm(secret: string): Promise<string | null> { return this.#state.confirm(secret); }
  async deliver(token: string): Promise<void> { await this.#state.deliver(token); }
  async fail(reason: LoginFailure): Promise<void> { await this.#state.fail(reason); }
  async abandon(handle: string): Promise<void> { await this.#state.abandon(handle); }
  async issueCode(secret: string, handle: string) {
    const result = await this.#state.issueCode(secret, handle);
    if (result?.codeDeadline) await this.ctx.storage.setAlarm(result.codeDeadline);
    return result;
  }
  async redeem(secret: string, code: string): Promise<string | null> { return this.#state.redeem(secret, code); }
  async alarm(): Promise<void> { this.ctx.storage.kv.delete("login"); }
}

type LoginCallbackProps = { pendingId: string; vendorId: string };

// Находит (или заводит) пользователя оболочки по подтверждённой почте и выдаёт токен сессии
// "<имя объекта>:<секрет>". null — заводить нового нельзя.
export async function signInViaGatekeeper(
    users: DurableObjectNamespace<UserDurableObject>, env: { LOGIN_ALIASES?: string }, email: string,
    vendorId: string, signupsEnabled: boolean,
    link: (stub: DurableObjectStub<UserDurableObject>) => Promise<void>): Promise<string | null> {
  // Почта может быть привязана к существующей учётной записи (login-aliases.ts).
  const target = shellLoginTarget(env, email);
  const userStub = users.get(users.idFromName(target.name));
  // Closed signups block first-time account creation here too (not just password signup); an
  // existing user signing in is unaffected. Исключение — Mnemos, см. login-policy.ts.
  const policy = gatekeeperLoginPolicy(vendorId, signupsEnabled);
  // Привязанная учётная запись обязана уже существовать: вместо неё пустую не заводим.
  const secret = await userStub.loginOrCreateViaGatekeeper(email, policy.allowCreate && !target.aliased);
  if (secret === null) return null;
  // For Cloudflare, signing in also links the account for AI Gateway billing: the login start
  // requested full (non-transient) scopes, so persist the grant as a connected account before
  // handing back the session. Other providers use minimal, transient sign-in grants (no persist).
  // Mnemos тоже: вход в оболочку через него сразу даёт подключённый Mnemos без второго входа.
  if (policy.persistConnection) await link(userStub);
  // Session tokens are "<doName>:<secret>"; PublicApi.authenticate() routes via idFromName of
  // the first part: почта или привязанное имя.
  return `${target.name}:${secret}`;
}

export class LoginConnectCallbackImpl
    extends WorkerEntrypoint<Cloudflare.Env, LoginCallbackProps>
    implements GatekeeperConnectCallback {
  #pending() {
    const id = this.ctx.exports.PendingLogin.idFromString(this.ctx.props.pendingId);
    return this.ctx.exports.PendingLogin.get(id);
  }

  // Гейткипер зовёт это в браузере, вернувшемся от провайдера, ДО записи личности: cookie входа
  // должна быть у этого браузера (auth/login-return.ts).
  async confirmBrowser(proof: ShellBrowserProof): Promise<{ returnPath: string } | null> {
    return confirmLoginBrowser(typeof proof?.login === "string" ? proof.login : undefined, this.ctx.props.pendingId, {
      create() { throw new Error("unreachable"); },
      get: id => this.ctx.exports.PendingLogin.get(this.ctx.exports.PendingLogin.idFromString(id)),
      async connect() { throw new Error("unreachable"); },
    });
  }

  async complete(account: Fetcher<GatekeeperUser>, expiresAt?: Date): Promise<void> {
    const loginLogger = logger.with({
      operation: "gatekeeper.login",
      vendorId: this.ctx.props.vendorId,
    });
    const pending = this.#pending();
    // `account` is a call parameter, so Cap'n Web disposes it automatically when this method
    // returns — no explicit disposal needed. We read the verified email to resolve/create the user.
    // The email's local-part seeds the initial display name, like the Cloudflare Access flow.
    try {
      const email = await account.getAuthenticatedEmail();
      if (!email) {
        loginLogger.info("gatekeeper login finished", {
          event: "gatekeeper.login.finished", outcome: "no_email",
        });
        await pending.fail("no_email");
        return;
      }
      const signupsEnabled = (await readAdminConfig(this.env)).signupsEnabled;
      const token = await signInViaGatekeeper(this.ctx.exports.UserDurableObject, this.env, email,
          this.ctx.props.vendorId, signupsEnabled,
          stub => stub.linkConnectedAccountFromLogin(account, this.ctx.props.vendorId, expiresAt));
      if (token === null) {
        loginLogger.info("gatekeeper login finished", {
          event: "gatekeeper.login.finished", outcome: "signups_disabled",
        });
        await pending.fail("signups_disabled");
        return;
      }
      await pending.deliver(token);
      loginLogger.info("gatekeeper login finished", {
        event: "gatekeeper.login.finished", outcome: "ok",
      });
    } catch (err) {
      loginLogger.error("gatekeeper login failed", {
        event: "gatekeeper.login.failed", error: err,
      });
      loginLogger.info("gatekeeper login finished", {
        event: "gatekeeper.login.finished", outcome: "error",
      });
      await pending.fail("failed").catch(() => {});
    }
  }

  // No-ops: for transient sign-in grants there's nothing persisted to update. For the Cloudflare
  // billing connection (persisted on login) these would ideally flip the account's credential flag,
  // but the callback doesn't carry the user/account identity (it's only learned in complete()). The
  // billing path degrades gracefully regardless — getUsableAccessToken() returns null on expiry and
  // the user falls back to the free tier / a reconnect prompt.
  async credentialsExpired(): Promise<void> {}
  async credentialsRestored(_expiresAt?: Date): Promise<void> {}
}
