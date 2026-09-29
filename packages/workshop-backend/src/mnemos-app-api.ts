// Связь страницы с экземпляром приложения узла Mnemos (ADR 0028 Mnemos, этап 2).
//
// Живёт в сеансе RPC человека (AuthenticatedApi.openMnemosApp). Права — только права Mnemos на узел:
// приглашение (чтение или правка), свой черновик проекта, общая версия проекта для отдела или
// организации. Они проверяются при открытии, на каждом вызове сервера гаджета (полная проверка не
// реже раза в 30 с) и по таймеру, пока связь открыта; у каждой проверки срок 10 с. Потеря доступа,
// понижение права или просроченная проверка закрывают весь сеанс RPC: вместе с ним рвутся и все
// ссылки, которые сервер гаджета держит на страницу.
//
// Код версии оболочка читает из Mnemos сама, правами открывшего: страница код не присылает, а
// открывший без права правки код сервера не получает вовсе.

import { RpcTarget } from "capnweb";
import { validateRpc } from "capnweb-validate";
import {
  GADGET_APP_MIME, gadgetAppSha256, parseGadgetAppText,
  type GadgetAppAccess, type GadgetAppCaller, type GadgetAppDirectory, type GadgetAppManifest, type MnemosAppConnection, type MnemosAppInfo,
} from "@gadgets/workshop-shared/gadget-app";
import type { GatekeeperAppAccess } from "@gadgets/workshop-shared/gatekeeper";
import { APP_PUBLISHED_ONLY, mnemosAppObjectName, type DeployedApp, type DeployOptions, type DirectoryScope } from "./mnemos-app";

/** Как часто перепроверяются права Mnemos при частых вызовах и по таймеру. */
export const APP_CHECK_MS = 30 * 1000;
/** Срок одной проверки права: зависшая проверка — отказ и закрытие сеанса. */
export const APP_CHECK_TIMEOUT_MS = 10 * 1000;
export const APP_ACCESS_CLOSED = "Доступ к приложению закрыт: владелец убрал вас из участников или изменил права.";
export const APP_EDIT_REQUIRED = "Сменить код приложения может только тот, у кого есть право правки файла.";
export const APP_VERSION_UNAVAILABLE = "Работающая версия приложения вам недоступна: попросите автора опубликовать её.";

type Deployed = Omit<DeployedApp, "chunks">;

/** Экземпляр узла (MnemosAppDurableObject). */
export type AppObjectPort = {
  state(): Promise<{ deployed: Deployed | null }>;
  deploy(version: string, sha256: string, text: string, by: string, options: DeployOptions): Promise<Deployed>;
  uiBundle(): Promise<{ jsCode: string } | null>;
  session(caller: GadgetAppCaller): Promise<unknown>;
};

/** Что связи нужно от установки; в тестах — подделки. */
export type MnemosAppPorts = {
  /** Право человека на узел, сессией человека в Mnemos. opening — первое открытие. */
  access(opening: boolean): Promise<GatekeeperAppAccess>;
  /** Билет Mnemos на версию узла (сумма и тип) с проверкой доступа к версии; тела не читает. */
  version(version: string): Promise<{ sha256: string; contentType: string }>;
  /** Точный текст версии узла правами человека: скачивает сама оболочка, сумма сверяется с билетом. */
  text(version: string): Promise<{ text: string; sha256: string; contentType: string }>;
  /** Последняя опубликованная версия приложения (без личных версий); null — публикаций нет. */
  latestPublished(): Promise<string | null>;
  /** Справочник людей и отделов с правами человека. */
  directory(): Promise<{ people: { id: string; name: string }[]; departments: { id: string; name: string; members: { id: string; name: string }[] }[] }>;
  /** Объект по ключу. */
  object(name: string): AppObjectPort;
  /** Имя человека в оболочке, если Mnemos его не назвал. */
  profileName(): Promise<string>;
  now(): number;
  /** Разовый таймер; возвращает отмену. */
  schedule(ms: number, run: () => void): () => void;
  /** Закрыть весь сеанс RPC человека. */
  abort(reason: Error): void;
  /** Освободить подключение Mnemos. */
  release(): void;
};

const RANK: Record<GadgetAppAccess, number> = { read: 0, edit: 1 };
const dispose = (value: unknown) => { try { (value as Partial<Disposable> | null | undefined)?.[Symbol.dispose]?.(); } catch { /* уже закрыт */ } };

/** Право одной связи: проверки и закрытие. */
export class AppGuard {
  #checkedAt: number;
  #ended = false;
  #tick: (() => void) | null = null;
  /** Кто и что открыл: повторная проверка должна назвать тех же человека, установку и узел. */
  constructor(private ports: MnemosAppPorts, readonly access: GadgetAppAccess, private identity: { principal: string; installation: string; project: string; node: string }) { this.#checkedAt = ports.now(); }

  get ended() { return this.#ended; }

  #fail(): never {
    if (!this.#ended) {
      this.#ended = true;
      this.#tick?.(); this.#tick = null;
      this.ports.abort(new Error(APP_ACCESS_CLOSED));
    }
    throw new Error(APP_ACCESS_CLOSED);
  }

  /** Ответ Mnemos о праве со сроком: зависшая проверка не держит связь открытой. */
  #accessWithDeadline(): Promise<GatekeeperAppAccess> {
    return new Promise((resolve, reject) => {
      const cancel = this.ports.schedule(APP_CHECK_TIMEOUT_MS, () => reject(new Error("Проверка права не уложилась в срок.")));
      this.ports.access(false).then(value => { cancel(); resolve(value); }, error => { cancel(); reject(error); });
    });
  }

  /** Полная проверка права на узел. Потеря, понижение права или просрочка — закрытие. */
  async check(): Promise<GadgetAppAccess> {
    if (this.#ended) this.#fail();
    let current: GatekeeperAppAccess;
    try { current = await this.#accessWithDeadline(); }
    catch { this.#fail(); }
    if (this.#ended) this.#fail();
    if (current.access !== "read" && current.access !== "edit") this.#fail();
    if (RANK[current.access] < RANK[this.access]) this.#fail();
    // Сменилось подключение Mnemos или Mnemos назвал другой узел: это уже не тот человек или не то приложение.
    if (current.principal !== this.identity.principal || current.installation !== this.identity.installation ||
        current.project !== this.identity.project || current.node !== this.identity.node) this.#fail();
    this.#checkedAt = this.ports.now();
    return current.access;
  }

  /** Для частых вызовов: полная проверка не реже раза в APP_CHECK_MS. */
  async recent(): Promise<void> {
    if (this.#ended) this.#fail();
    if (this.ports.now() - this.#checkedAt >= APP_CHECK_MS) await this.check();
  }

  /** Связь с сервером гаджета живёт и без вызовов (подписки): право перепроверяется по таймеру. */
  watch(): void {
    if (this.#tick || this.#ended) return;
    const tick = () => {
      this.#tick = null;
      void this.check().then(() => { if (!this.#ended) this.#tick = this.ports.schedule(APP_CHECK_MS, tick); }, () => {});
    };
    this.#tick = this.ports.schedule(APP_CHECK_MS, tick);
  }

  /** Связь больше не нужна: таймер снимается, сеанс не трогается. */
  stop(): void { this.#tick?.(); this.#tick = null; this.#ended = true; }
}

/** Связь с сервером гаджета: перед каждым вызовом верхнего уровня — проверка права. */
function gatedSession(guard: AppGuard, session: unknown): unknown {
  const target = session as Record<string | symbol, unknown>;
  return new Proxy(new RpcTarget() as unknown as Record<string | symbol, unknown>, {
    get(self, property, receiver) {
      if (typeof property === "symbol") {
        if (property === Symbol.dispose) return () => dispose(session);
        return Reflect.get(self, property, receiver);
      }
      if (property === "then" || property === "constructor") return undefined;
      return async (...args: unknown[]) => {
        await guard.recent();
        const method = target[property];
        if (typeof method !== "function") throw new Error(`Нет метода ${property}.`);
        // Reflect.apply, а не method.apply: у заглушки RPC любое свойство — вызов по сети.
        return Reflect.apply(method as (...a: unknown[]) => unknown, target, args);
      };
    },
  });
}

/**
 * Открыть связь: первое право читается сразу; нет доступа — ошибка без связи. personal — свой экземпляр
 * открывшего (приложение без совместной работы). Ключ объекта — из ответа Mnemos, не из ввода страницы.
 */
export async function openMnemosAppConnection(ports: MnemosAppPorts, personal: boolean): Promise<MnemosAppConnectionImpl> {
  let first: GatekeeperAppAccess;
  try { first = await ports.access(true); }
  catch (error) { ports.release(); throw error instanceof Error && /[А-Яа-яЁё]/.test(error.message) ? error : new Error("Приложение вам недоступно."); }
  if ((first.access !== "read" && first.access !== "edit") || !first.principal || !first.tenant || !first.project || !first.node || !first.installation) { ports.release(); throw new Error("Приложение вам недоступно."); }
  const name = first.name || await ports.profileName().catch(() => "");
  const key = mnemosAppObjectName(first.installation, first.tenant, first.project, first.node, personal ? first.principal : undefined);
  const guard = new AppGuard(ports, first.access, { principal: first.principal, installation: first.installation, project: first.project, node: first.node });
  return new MnemosAppConnectionImpl(ports, guard, ports.object(key), { principal: first.principal, name }, personal);
}

/** Справочник только с именами и служебными ключами. */
function cleanDirectory(directory: Awaited<ReturnType<MnemosAppPorts["directory"]>>): GadgetAppDirectory {
  return {
    people: directory.people.map(p => ({ id: String(p.id), name: String(p.name) })),
    departments: directory.departments.map(u => ({ id: String(u.id), name: String(u.name), members: u.members.map(m => ({ id: String(m.id), name: String(m.name) })) })),
  };
}

@validateRpc()
export class MnemosAppConnectionImpl extends RpcTarget implements MnemosAppConnection {
  /** Версия, доступ к которой уже подтверждён этой связью. */
  #readable = "";
  constructor(private ports: MnemosAppPorts, private guard: AppGuard, private object: AppObjectPort,
      private caller: { principal: string; name: string }, private personal: boolean) { super(); }

  [Symbol.dispose]() { this.guard.stop(); this.ports.release(); }

  async #info(): Promise<MnemosAppInfo> {
    const { deployed } = await this.object.state();
    return {
      access: this.guard.access, caller: { ...this.caller },
      deployed: deployed ? { version: deployed.version, sha256: deployed.sha256, title: deployed.title, collaborative: deployed.collaborative } : null,
    };
  }

  /** Работающая версия должна быть доступна и самому открывшему: иначе он увидел бы неопубликованное. */
  async #requireReadable(): Promise<Deployed> {
    const { deployed } = await this.object.state();
    if (!deployed) throw new Error("Приложение ещё не запущено: откройте его версию.");
    if (this.#readable !== deployed.sha256) {
      const ticket = await this.ports.version(deployed.version).catch(() => null);
      if (!ticket || ticket.sha256 !== deployed.sha256 || ticket.contentType !== GADGET_APP_MIME) throw new Error(APP_VERSION_UNAVAILABLE);
      this.#readable = deployed.sha256;
    }
    return deployed;
  }

  /** Текст версии, прочитанный оболочкой: тип, сумма и формат сверены. */
  async #text(version: string) {
    if (typeof version !== "string" || !version || version.length > 300) throw new Error("Неверная версия приложения.");
    const read = await this.ports.text(version).catch(() => null);
    if (!read || read.contentType !== GADGET_APP_MIME || await gadgetAppSha256(read.text) !== read.sha256) throw new Error("Версия приложения недоступна или повреждена.");
    return { text: read.text, sha256: read.sha256, envelope: parseGadgetAppText(read.text) };
  }

  async describe(): Promise<MnemosAppInfo> {
    await this.guard.check();
    return this.#info();
  }

  async manifest(version: string): Promise<GadgetAppManifest> {
    await this.guard.check();
    return (await this.#text(version)).envelope.document.manifest;
  }

  async getUiBundle(): Promise<{ jsCode: string } | null> {
    await this.guard.recent();
    const { deployed } = await this.object.state();
    if (!deployed) return null;
    await this.#requireReadable();
    return this.object.uiBundle();
  }

  async connectToGadget(): Promise<unknown> {
    await this.guard.check();
    const deployed = await this.#requireReadable();
    const caller: GadgetAppCaller = {
      principal: this.caller.principal, name: this.caller.name, access: this.guard.access,
      // Справочник открывшего; общий экземпляр сузит его до видимого запустившему.
      ...(deployed.permissions.includes("directory") ? { directory: cleanDirectory(await this.ports.directory()) } : {}),
    };
    const session = await this.object.session(caller);
    this.guard.watch();
    return gatedSession(this.guard, session);
  }

  async deploy(version: string): Promise<MnemosAppInfo> {
    const access = await this.guard.check();
    const { text, sha256, envelope } = await this.#text(version);
    const manifest = envelope.document.manifest;
    if (this.personal) {
      if (manifest.collaborative) throw new Error("Совместное приложение работает общим экземпляром.");
      await this.object.deploy(version, sha256, text, this.caller.principal, { kind: "personal", onlyIfEmpty: false, directoryScope: null });
    } else {
      if (version.startsWith("private:")) throw new Error(APP_PUBLISHED_ONLY);
      if (!manifest.collaborative) throw new Error("Приложение не совместное: общий экземпляр ему не нужен.");
      let directoryScope: DirectoryScope | null = null;
      if (access === "edit") {
        // Запустивший отвечает за код: справочник экземпляра не шире того, что видит он.
        const directory = cleanDirectory(await this.ports.directory());
        directoryScope = { people: directory.people.map(p => p.id), units: directory.departments.map(u => u.id) };
      } else if (await this.ports.latestPublished() !== version) {
        // Без права правки — только первый запуск пустого экземпляра последней опубликованной версией.
        throw new Error(APP_EDIT_REQUIRED);
      }
      await this.object.deploy(version, sha256, text, this.caller.principal, { kind: "shared", onlyIfEmpty: access !== "edit", directoryScope });
    }
    this.#readable = sha256;
    return this.#info();
  }
}
