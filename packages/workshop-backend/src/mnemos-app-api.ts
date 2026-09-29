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
  type MnemosAppCopies, type MnemosAppCopyState, type MnemosAppOffer, type MnemosAppRelease,
} from "@gadgets/workshop-shared/gadget-app";
import type { GatekeeperAppAccess } from "@gadgets/workshop-shared/gatekeeper";
import {
  APP_PUBLISHED_ONLY, mnemosAppObjectName, mnemosAppReleaseName,
  type AppCopyLink, type AppOrigin, type AppReleaseMeta, type DeployedApp, type DeployOptions, type DirectoryScope,
} from "./mnemos-app";

/** Как часто перепроверяются права Mnemos при частых вызовах и по таймеру. */
export const APP_CHECK_MS = 30 * 1000;
/** Срок одной проверки права: зависшая проверка — отказ и закрытие сеанса. */
export const APP_CHECK_TIMEOUT_MS = 10 * 1000;
export const APP_ACCESS_CLOSED = "Доступ к приложению закрыт: владелец убрал вас из участников или изменил права.";
export const APP_EDIT_REQUIRED = "Сменить код приложения может только тот, у кого есть право правки файла.";
export const APP_VERSION_UNAVAILABLE = "Работающая версия приложения вам недоступна: попросите автора опубликовать её.";
export const APP_COPY_REQUIRED = "Чужое приложение без общих данных открывается вашей копией: создайте её.";
export const APP_NO_RELEASE = "Автор ещё не опубликовал приложение: копию можно будет сделать после публикации.";
export const APP_ORIGIN_CLOSED = "Автор закрыл вам доступ к оригиналу: копия остаётся вашей, но обновлений от автора больше не будет.";
export const APP_ORIGIN_UNKNOWN = "Не удалось проверить доступ к оригиналу в Mnemos. Повторите позже.";
export const APP_UPDATE_CHANGED = "Автор успел опубликовать другую версию. Откройте приложение заново и посмотрите обновление.";
export const APP_COPY_OWNER_ONLY = "Обновить копию может только её владелец.";

type Deployed = Omit<DeployedApp, "chunks">;

/** Экземпляр узла (MnemosAppDurableObject). */
export type AppObjectPort = {
  state(): Promise<{ deployed: Deployed | null }>;
  deploy(version: string, sha256: string, text: string, by: string, options: DeployOptions): Promise<Deployed>;
  uiBundle(): Promise<{ jsCode: string } | null>;
  session(caller: GadgetAppCaller): Promise<unknown>;
  // Копии (этап 3): версия для копий, связь копии с оригиналом, где лежит копия получателя.
  release(): Promise<AppReleaseMeta | null>;
  setRelease(version: string, sha256: string, text: string, publishedAt: string, authorName: string): Promise<AppReleaseMeta>;
  releaseText(): Promise<{ release: AppReleaseMeta; text: string } | null>;
  origin(): Promise<AppOrigin | null>;
  setOrigin(origin: AppOrigin): Promise<void>;
  dismissUpdate(version: string): Promise<void>;
  copyLink(): Promise<AppCopyLink | null>;
  setCopyLink(link: AppCopyLink): Promise<void>;
};

/** Последняя опубликованная версия узла: id, время публикации и кто опубликовал (principal). */
export type PublishedHead = { id: string; recordedAt: string; actor: string };

/** Чтения и право для одного узла сессией человека в Mnemos. */
export type AppNodePorts = {
  /** Право человека на узел. opening — первое открытие (читаются организация и имя). */
  access(opening: boolean): Promise<GatekeeperAppAccess>;
  /** Билет Mnemos на версию узла (сумма и тип) с проверкой доступа к версии; тела не читает. */
  version(version: string): Promise<{ sha256: string; contentType: string }>;
  /** Точный текст версии узла правами человека: скачивает сама оболочка, сумма сверяется с билетом. */
  text(version: string): Promise<{ text: string; sha256: string; contentType: string }>;
  /** Последняя опубликованная версия приложения (без личных версий); null — публикаций нет. */
  latestPublished(): Promise<string | null>;
  /** То же с временем и автором публикации; null — публикаций нет или история человеку закрыта. */
  publishedHead(): Promise<PublishedHead | null>;
};

/** Что связи нужно от установки; в тестах — подделки. Методы узла — для открытого узла. */
export type MnemosAppPorts = AppNodePorts & {
  /** Те же чтения для другого узла: оригинал копии или только что созданная копия. */
  node(project: string, node: string): AppNodePorts;
  /** Создать узел приложения с этим текстом в проекте человека (его личная версия проекта). Тело
   *  выгружает оболочка прямо в хранилище по билету Mnemos. */
  createApp(project: string, name: string, text: string): Promise<{ node: string; head: string }>;
  /** Новая личная версия своего узла приложения; только владелец узла. Возвращает голову. */
  saveApp(project: string, node: string, text: string): Promise<string>;
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
  return new MnemosAppConnectionImpl(ports, guard, ports.object(key), { principal: first.principal, name }, personal,
    { installation: first.installation, tenant: first.tenant, project: first.project, node: first.node });
}

/** Имя узла копии в проекте получателя. */
export function copyNodeName(title: string): string {
  let base = title.replace(/[/\\\u0000-\u001f\u007f]/g, " ").trim() || "Приложение";
  while (new TextEncoder().encode(`${base} (копия)`).length > 255) base = base.slice(0, -1);
  return `${base} (копия)`;
}

const releaseInfo = (release: AppReleaseMeta): MnemosAppRelease => ({ version: release.version, title: release.title, publishedAt: release.publishedAt, authorName: release.authorName });
/** Отказ Mnemos в доступе к узлу приложения (текст APP_ACCESS_DENIED моста) — отзыв, а не сбой связи. */
const isAccessDenied = (error: unknown) => error instanceof Error && /нет доступа к этому файлу/.test(error.message);

/** Справочник только с именами и служебными ключами. */
function cleanDirectory(directory: Awaited<ReturnType<MnemosAppPorts["directory"]>>): GadgetAppDirectory {
  return {
    people: directory.people.map(p => ({ id: String(p.id), name: String(p.name) })),
    departments: directory.departments.map(u => ({ id: String(u.id), name: String(u.name), members: u.members.map(m => ({ id: String(m.id), name: String(m.name) })) })),
  };
}

@validateRpc()
export class MnemosAppConnectionImpl extends RpcTarget implements MnemosAppConnection, MnemosAppCopies {
  /** Версия, доступ к которой уже подтверждён этой связью. */
  #readable = "";
  /** identity — установка, организация, проект и узел, как их назвал Mnemos при открытии. */
  constructor(private ports: MnemosAppPorts, private guard: AppGuard, private object: AppObjectPort,
      private caller: { principal: string; name: string }, private personal: boolean,
      private identity: { installation: string; tenant: string; project: string; node: string }) { super(); }

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
      // Получатель без права правки читает только опубликованную версию оригинала, и то — в своей копии.
      if (access !== "edit" && (version.startsWith("private:") || await this.ports.latestPublished() !== version)) throw new Error(APP_COPY_REQUIRED);
      await this.object.deploy(version, sha256, text, this.caller.principal, { kind: "personal", onlyIfEmpty: false, directoryScope: null });
      // Публикация автора сразу становится версией для копий.
      if (!version.startsWith("private:")) await this.#refreshRelease(this.ports, access, this.#releaseObject(this.identity)).catch(() => null);
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

  // ─── Копии (этап 3) ───────────────────────────────────────────────────────────────────────────

  #releaseObject(node: { installation: string; tenant: string; project: string; node: string }) {
    return this.ports.object(mnemosAppReleaseName(node.installation, node.tenant, node.project, node.node));
  }

  #now() { return new Date(this.ports.now()).toISOString(); }

  /**
   * Версия для копий. Если человек сам видит в истории Mnemos более новую публикацию (автор, соавтор,
   * отдел или организация по уровню проекта), она записывается: текст читается его правами, сумма
   * сверяется. Приглашённый поимённо истории не видит и получает то, что записал автор.
   */
  async #refreshRelease(node: AppNodePorts, access: GadgetAppAccess, release: AppObjectPort): Promise<AppReleaseMeta | null> {
    const current = await release.release();
    const head = await node.publishedHead().catch(() => null);
    if (!head || current?.version === head.id) return current;
    const read = await node.text(head.id).catch(() => null);
    if (!read || read.contentType !== GADGET_APP_MIME || await gadgetAppSha256(read.text) !== read.sha256) return current;
    if (parseGadgetAppText(read.text).document.manifest.collaborative) return current;
    let author = "";
    try { author = (await this.ports.directory()).people.find(p => p.id === head.actor)?.name ?? ""; } catch { /* имя не обязательно */ }
    if (!author && access === "edit" && head.actor === this.caller.principal) author = this.caller.name;
    return release.setRelease(head.id, read.sha256, read.text, head.recordedAt, author).catch(() => current);
  }

  /** Доступ к оригиналу копии правами владельца копии и версия для копий. */
  async #reachOrigin(origin: AppOrigin): Promise<{ state: "open" | "closed" | "unknown"; release: AppReleaseMeta | null }> {
    const node = this.ports.node(origin.project, origin.node);
    let access: GatekeeperAppAccess;
    try { access = await node.access(true); }
    catch (error) { return { state: isAccessDenied(error) ? "closed" : "unknown", release: null }; }
    if (access.access !== "read" && access.access !== "edit") return { state: "closed", release: null };
    // Другое подключение Mnemos, другая установка или другой узел — это уже не тот оригинал.
    if (access.principal !== this.caller.principal || access.installation !== origin.installation || access.project !== origin.project ||
        access.node !== origin.node || (access.tenant && access.tenant !== origin.tenant)) return { state: "unknown", release: null };
    return { state: "open", release: await this.#refreshRelease(node, access.access, this.#releaseObject(origin)) };
  }

  async offer(): Promise<MnemosAppOffer> {
    const access = await this.guard.check();
    if (!this.personal) throw new Error("Совместным приложением делятся доступом к общему экземпляру, копий у него нет.");
    const release = await this.#refreshRelease(this.ports, access, this.#releaseObject(this.identity));
    const link = await this.object.copyLink();
    return { release: release ? releaseInfo(release) : null, copy: link ? { scope: link.project, resource: link.node } : null };
  }

  async makeCopy(scope: string, again: boolean): Promise<{ scope: string; resource: string }> {
    await this.guard.check();
    if (!this.personal) throw new Error("Совместным приложением делятся доступом к общему экземпляру, копий у него нет.");
    if (typeof scope !== "string" || !scope || scope.length > 255 || typeof again !== "boolean") throw new Error("Выберите проект для копии.");
    const link = await this.object.copyLink();
    if (link && !again) return { scope: link.project, resource: link.node };
    const stored = await this.#releaseObject(this.identity).releaseText();
    if (!stored) throw new Error(APP_NO_RELEASE);
    const { release, text } = stored;
    const title = parseGadgetAppText(text).document.manifest.title;
    const created = await this.ports.createApp(scope, copyNodeName(title), text);
    // Ключ экземпляра копии — из ответа Mnemos о праве на новый узел, как при любом открытии.
    const target = this.ports.node(scope, created.node);
    const mine = await target.access(true);
    if (mine.access !== "edit" || mine.principal !== this.caller.principal || mine.installation !== this.identity.installation ||
        mine.node !== created.node || !mine.tenant || !mine.project) throw new Error("Копия создана, но Mnemos не подтвердил её владельца. Откройте её из проекта.");
    const version = `private:${created.head}`;
    const read = await target.text(version).catch(() => null);
    if (!read || read.contentType !== GADGET_APP_MIME || read.sha256 !== release.sha256 || await gadgetAppSha256(read.text) !== read.sha256) {
      throw new Error("Копия записана не так, как опубликовал автор. Откройте приложение заново.");
    }
    const copyObject = this.ports.object(mnemosAppObjectName(mine.installation, mine.tenant, mine.project, mine.node, this.caller.principal));
    const now = this.#now();
    await copyObject.setOrigin({ installation: this.identity.installation, tenant: this.identity.tenant, project: this.identity.project, node: this.identity.node,
      version: release.version, sha256: release.sha256, title, authorName: release.authorName, copiedAt: now, updatedAt: now, dismissed: "" });
    await copyObject.deploy(version, read.sha256, read.text, this.caller.principal, { kind: "personal", onlyIfEmpty: false, directoryScope: null });
    await this.object.setCopyLink({ project: mine.project, node: mine.node });
    return { scope: mine.project, resource: mine.node };
  }

  async copyState(): Promise<MnemosAppCopyState | null> {
    await this.guard.check();
    if (!this.personal) return null;
    const origin = await this.object.origin();
    if (!origin) return null;
    const reach = await this.#reachOrigin(origin);
    const fresh = reach.release && reach.release.sha256 !== origin.sha256 && reach.release.version !== origin.version ? releaseInfo(reach.release) : null;
    return { author: origin.authorName, title: origin.title, version: origin.version, copiedAt: origin.copiedAt, updatedAt: origin.updatedAt,
      origin: reach.state, update: fresh, dismissed: !!fresh && origin.dismissed === fresh.version };
  }

  async applyUpdate(version: string): Promise<{ version: string }> {
    const access = await this.guard.check();
    if (typeof version !== "string" || !version || version.length > 300) throw new Error(APP_UPDATE_CHANGED);
    const origin = this.personal ? await this.object.origin() : null;
    if (!origin || access !== "edit") throw new Error(APP_COPY_OWNER_ONLY);
    const reach = await this.#reachOrigin(origin);
    if (reach.state === "closed") throw new Error(APP_ORIGIN_CLOSED);
    if (reach.state !== "open") throw new Error(APP_ORIGIN_UNKNOWN);
    const stored = await this.#releaseObject(origin).releaseText();
    // Ставится ровно та версия, которую человек видел в шапке.
    if (!stored || stored.release.version !== version) throw new Error(APP_UPDATE_CHANGED);
    // Пишется только свой узел копии; оригинал только читается.
    const head = await this.ports.saveApp(this.identity.project, this.identity.node, stored.text);
    const next = `private:${head}`;
    const { text, sha256, envelope } = await this.#text(next);
    if (sha256 !== stored.release.sha256) throw new Error("Обновление записано не так, как опубликовал автор. Откройте приложение заново.");
    if (envelope.document.manifest.collaborative) throw new Error("Совместное приложение работает общим экземпляром.");
    await this.object.deploy(next, sha256, text, this.caller.principal, { kind: "personal", onlyIfEmpty: false, directoryScope: null });
    await this.object.setOrigin({ ...origin, version: stored.release.version, sha256, title: envelope.document.manifest.title, updatedAt: this.#now(), dismissed: "" });
    this.#readable = sha256;
    return { version: next };
  }

  async dismissUpdate(version: string): Promise<void> {
    await this.guard.check();
    if (!this.personal || !(await this.object.origin())) throw new Error(APP_COPY_OWNER_ONLY);
    await this.object.dismissUpdate(version);
  }
}
