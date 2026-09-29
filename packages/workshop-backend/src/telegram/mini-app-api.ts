// Точка RPC Telegram Mini App (ADR 0027 Mnemos, раздел 6): редактор одного документа по сессии
// Mini App. Сессию выдаёт объект бота после проверки initData; здесь она проверяется на каждом
// вызове (владелец, бот, срок, аккаунт Mnemos), и наружу отдаётся только этот документ: код экрана,
// связь с сервером редактора (перечень методов ниже), сохранение и версии в Mnemos. Права Mnemos
// проверяет сам Mnemos: каждый вызов идёт сессией человека через его подключение.

import { RpcTarget } from "capnweb";
import { validateRpc } from "capnweb-validate";
import { ACCENT_PALETTE, isAccentChoice, isAccentHex, type AppearancePreference } from "@gadgets/workshop-shared/accent-theme";
import type { GatekeeperDownloadTicket, GatekeeperUploadTicket } from "@gadgets/workshop-shared/gatekeeper";
import type { NativeDocumentFormat, NativeMnemosBinding, NativeMnemosState } from "@gadgets/workshop-shared/native-document";
import type { MnemosAppBinding, MnemosAppConnection } from "@gadgets/workshop-shared/gadget-app";
import {
  MINI_APP_SESSION, type MiniAppDocument, type MiniAppDocumentInfo, type MiniAppMnemosState, type MiniAppPublicApi,
  type MiniAppVersion,
} from "@gadgets/workshop-shared/telegram-mini-app";
import type { AppDocumentRef, MiniAppSessionGrant } from "./personal-bot";

/** Методы сервера встроенных редакторов, нужные экрану, снимку и возврату версии. Остальные
 *  (например, выгрузка в Google Docs по привязке вывода) из Mini App недоступны. */
export const MINI_APP_EDITOR_METHODS = [
  "subscribe", "applyOperation", "initializeBlocks", "exportDocumentSnapshot", "updatePresence", "leavePresence",
  "getDeck", "getUndoState", "mutateDocument", "updateBlockText", "getDocument", "restoreDocumentSnapshot",
] as const;

/** Как часто вызовы редактора перепроверяют сессию (правка идёт часто, проверка — поход в два объекта). */
export const EDITOR_CHECK_MS = 30 * 1000;
/** Кто захватывает создание документа в Mnemos из Mini App. */
export const MINI_APP_HOLDER = "telegram-mini-app";
export const SESSION_ENDED = "Сессия Mini App закончилась. Нажмите «Открыть» в Telegram ещё раз.";
/** Код отказа по сессии: клиент отличает его от прочих ошибок. */
export const SESSION_ENDED_CODE = "MINI_APP_SESSION_ENDED";
const sessionEnded = () => Object.assign(new Error(SESSION_ENDED), { code: SESSION_ENDED_CODE });
export const NOT_IN_MNEMOS = "Документ ещё не сохранён в Mnemos.";
export const APP_ON_SITE = "Код и версии приложения меняются на сайте.";

type Stub<T> = T & Partial<Disposable>;

/** Документ беседы (OverseerDurableObject.openMiniAppDocument). */
export type MiniAppDocumentPort = Stub<{
  info(): Promise<{ title: string; format: NativeDocumentFormat | "cloudflareos.app"; sitePath: string }>;
  /** Приложение (ADR 0028): привязка к узлу и показывать ли экземпляр узла (код не менялся после
   *  сохранения или кода в рабочем месте нет вовсе — открывший без права правки). */
  app(): Promise<{ binding: MnemosAppBinding | null; saved: boolean }>;
  uiBundle(): Promise<{ jsCode: string } | null>;
  editor(): Promise<Record<string, (...args: unknown[]) => Promise<unknown>>>;
  mnemosState(): Promise<NativeMnemosState>;
  setMnemosDocument(binding: NativeMnemosBinding): Promise<void>;
  claimMnemosDocument(accountId: number, scope: string, name: string, holder: string): Promise<{ claim: string; name: string } | null>;
  releaseMnemosDocument(claim: string): Promise<void>;
  recordMnemosDocumentReceipt(claim: string, receipt: string): Promise<void>;
}>;

type MnemosEditor = Stub<{
  head(): Promise<string>;
  access(): Promise<"owner" | "write" | "read">;
  issue(expectedHead: string, size: number, checksum: string): Promise<GatekeeperUploadTicket>;
  save(expectedHead: string, uploadId: string): Promise<string>;
}>;
type MnemosCreator = Stub<{
  head(): Promise<string>;
  issue(expectedHead: string, size: number, checksum: string): Promise<GatekeeperUploadTicket>;
  checkpoint(expectedHead: string, uploadId: string): Promise<string>;
  save(expectedHead: string, uploadId: string): Promise<string>;
  document(): Promise<string>;
}>;
type MnemosDownload = Stub<{ issue(): Promise<GatekeeperDownloadTicket & { content_type: string }>; validate(): Promise<void> }>;

/** Сохранение и версии из подключения Mnemos человека (UserDurableObject.miniAppMnemos). */
export type MnemosPort = {
  accountId: number; principal: string; storageOrigin: string;
  writes: Stub<{
    select(scope: string, resource: string, format: NativeDocumentFormat): Promise<MnemosEditor>;
    create(scope: string, name: string, format: NativeDocumentFormat): Promise<MnemosCreator>;
    /** Право на узел приложения (ADR 0028). */
    appAccess(scope: string, resource: string, opening: boolean): Promise<import("@gadgets/workshop-shared/gatekeeper").GatekeeperAppAccess>;
    /** Справочник людей и отделов с правами человека. */
    appDirectory(): Promise<{ people: { id: string; name: string }[]; departments: { id: string; name: string; members: { id: string; name: string }[] }[] }>;
  }>;
  downloads: Stub<{
    publications(scope: string, resource: string, cursor: string): Promise<{ publications: { id: string; recordedAt: string; actor: string; author?: string; onBehalfOf?: string; format: NativeDocumentFormat | "cloudflareos.app" }[]; nextCursor: string }>;
    select(scope: string, resource: string, publication: string): Promise<MnemosDownload>;
  }>;
};

/** Что серверу Mini App нужно от установки; в тестах — подделки. */
export interface MiniAppPorts {
  session(route: string, secret: string): Promise<MiniAppSessionGrant | null>;
  endSession(route: string, secret: string): Promise<void>;
  principal(owner: string): Promise<string | null>;
  openDocument(owner: string, document: AppDocumentRef): Promise<MiniAppDocumentPort>;
  mnemos(owner: string, accountId: number | null): Promise<MnemosPort>;
  appearance(owner: string): Promise<{ preference: AppearancePreference | null; deployment: string }>;
  now(): number;
  /** Разовый таймер; возвращает отмену. */
  schedule(ms: number, run: () => void): () => void;
  /** Связь с общим экземпляром приложения узла от имени владельца бота; abort закрывает связь Mini App. */
  openApp(owner: string, accountId: number, scope: string, resource: string, personal: boolean, abort: (reason: Error) => void): Promise<MnemosAppConnection & Partial<Disposable>>;
}

const dispose = (value: unknown) => { try { (value as Partial<Disposable> | null | undefined)?.[Symbol.dispose]?.(); } catch { /* уже закрыт */ } };

/** Цвет акцента человека, как на сайте: выбор из палитры, иначе цвет установки, иначе зелёный Mnemos. */
export function miniAppAccent(preference: AppearancePreference | null, deployment: string): string {
  let choice = preference?.accent;
  if (choice && isAccentChoice(choice)) return ACCENT_PALETTE.find(option => option.id === choice)!.color;
  return isAccentHex(deployment) ? deployment : ACCENT_PALETTE[0].color;
}

/** Сессия одной связи: проверки и отзыв. */
class SessionGuard {
  #checkedAt = -Infinity;
  #ended = false;
  #tick: (() => void) | null = null;
  #deadline: (() => void) | null = null;
  constructor(private ports: MiniAppPorts, private route: string, private secret: string,
      readonly owner: string, readonly document: AppDocumentRef, readonly principal: string | null,
      private abort: (reason: Error) => void) {}

  /** Связь живёт, даже когда страница ничего не зовёт (подписка редактора получает правки). Поэтому
   *  сессия перепроверяется по таймеру, а в момент предельного срока связь закрывается сама. */
  watch(endsAt: number): void {
    let tick = () => {
      this.#tick = null;
      void this.check().then(() => { if (!this.#ended) this.#tick = this.ports.schedule(EDITOR_CHECK_MS, tick); }, () => {});
    };
    this.#tick = this.ports.schedule(EDITOR_CHECK_MS, tick);
    this.#deadline = this.ports.schedule(Math.max(0, endsAt - this.ports.now()), () => { this.#deadline = null; this.close(); });
  }

  /** Сессия больше не нужна («Закрыть», страница ушла, связь оборвалась): удалить у бота и закрыть связь. */
  close(): void {
    try { this.#fail(); } catch { /* ожидаемо */ }
  }

  #fail(): never {
    if (!this.#ended) {
      this.#ended = true;
      this.#tick?.(); this.#deadline?.(); this.#tick = this.#deadline = null;
      void this.ports.endSession(this.route, this.secret).catch(() => {});
      this.abort(new Error("mini app session ended"));
    }
    throw sessionEnded();
  }

  /** Полная проверка: сессия у объекта бота (продлевается), тот же документ и тот же аккаунт Mnemos. */
  async check(): Promise<void> {
    if (this.#ended) this.#fail();
    let grant = await this.ports.session(this.route, this.secret).catch(() => null);
    if (!grant || grant.owner !== this.owner || grant.document.workspace !== this.document.workspace || grant.document.gadget !== this.document.gadget) this.#fail();
    let principal = await this.ports.principal(this.owner).catch(() => undefined);
    if (principal === undefined || principal !== this.principal) this.#fail();
    this.#checkedAt = this.ports.now();
  }

  /** Для частых вызовов редактора: полная проверка не чаще раза в EDITOR_CHECK_MS. */
  async recent(): Promise<void> {
    if (this.#ended) this.#fail();
    if (this.ports.now() - this.#checkedAt >= EDITOR_CHECK_MS) await this.check();
  }
}

@validateRpc()
export class MiniAppPublicApiImpl extends RpcTarget implements MiniAppPublicApi {
  #opened = false;
  constructor(private ports: MiniAppPorts, private abort: (reason: Error) => void) { super(); }

  /** Одна связь — один документ: второй open на той же связи — отказ. */
  async open(session: string): Promise<MiniAppDocument> {
    if (this.#opened || typeof session !== "string" || !MINI_APP_SESSION.test(session)) throw sessionEnded();
    this.#opened = true;
    let [route, secret] = session.split(".");
    let grant = await this.ports.session(route, secret).catch(() => null);
    if (!grant) { this.abort(new Error("mini app session refused")); throw sessionEnded(); }
    let guard = new SessionGuard(this.ports, route, secret, grant.owner, grant.document, grant.principal, this.abort);
    await guard.check();
    guard.watch(grant.endsAt);
    let document = await this.ports.openDocument(grant.owner, grant.document).catch(error => { guard.close(); throw error; });
    // @ts-expect-error RpcTarget, реализующий интерфейс, передаётся вместо заглушки.
    return new MiniAppDocumentImpl(this.ports, guard, document, this.abort);
  }
}

@validateRpc()
class MiniAppDocumentImpl extends RpcTarget {
  #mnemos: Promise<MnemosPort> | null = null;
  #mnemosAccount: number | null = null;
  #format: NativeDocumentFormat | "cloudflareos.app" | null = null;
  #app: Promise<(MnemosAppConnection & Partial<Disposable>) | null> | null = null;

  constructor(private ports: MiniAppPorts, private guard: SessionGuard, private document: MiniAppDocumentPort, private abort: (reason: Error) => void = () => {}) { super(); }

  // Связь оборвалась или страница отпустила документ: сессию больше никто не использует.
  [Symbol.dispose]() {
    this.guard.close();
    dispose(this.document);
    void this.#app?.then(dispose, () => {});
    void this.#mnemos?.then(port => { dispose(port.writes); dispose(port.downloads); }, () => {});
  }

  /** «Закрыть» в Mini App: сессия удаляется у бота, связь закрывается. */
  async close(): Promise<void> {
    this.guard.close();
  }

  async #anyFormat(): Promise<NativeDocumentFormat | "cloudflareos.app"> {
    return this.#format ??= (await this.document.info()).format;
  }

  /** Формат встроенного документа; у приложения сохранение и версии — только на сайте. */
  async #formatOf(): Promise<NativeDocumentFormat> {
    let format = await this.#anyFormat();
    if (format === "cloudflareos.app") throw new Error(APP_ON_SITE);
    return format;
  }

  /** Общий экземпляр совместного приложения, если код не менялся после сохранения; иначе null — экран рабочего места. */
  async #live(): Promise<(MnemosAppConnection & Partial<Disposable>) | null> {
    if (await this.#anyFormat() !== "cloudflareos.app") return null;
    this.#app ??= (async () => {
      let { binding, saved } = await this.document.app();
      if (!binding || !saved) return null;
      return this.ports.openApp(this.guard.owner, binding.accountId, binding.scope, binding.resource, !binding.collaborative, this.abort);
    })();
    this.#app.catch(() => { this.#app = null; });
    return this.#app;
  }

  /** Подключение Mnemos того аккаунта, что был при выдаче сессии. */
  async #port(accountId: number | null): Promise<MnemosPort> {
    if (this.#mnemos && this.#mnemosAccount === accountId) return this.#mnemos;
    let previous = this.#mnemos;
    this.#mnemosAccount = accountId;
    this.#mnemos = this.ports.mnemos(this.guard.owner, accountId).then(port => {
      if (port.principal !== this.guard.principal) { dispose(port.writes); dispose(port.downloads); throw sessionEnded(); }
      return port;
    });
    this.#mnemos.catch(() => { this.#mnemos = null; });
    void previous?.then(port => { dispose(port.writes); dispose(port.downloads); }, () => {});
    return this.#mnemos;
  }

  async #binding(): Promise<NativeMnemosBinding> {
    let state = await this.document.mnemosState();
    if (!state.binding) throw new Error(NOT_IN_MNEMOS);
    return state.binding;
  }

  async describe(): Promise<MiniAppDocumentInfo> {
    await this.guard.check();
    let [info, state, look] = await Promise.all([this.document.info(), this.document.mnemosState(), this.ports.appearance(this.guard.owner)]);
    this.#format = info.format;
    let mnemos: MiniAppMnemosState = { kind: "none" };
    let storageOrigin = "";
    try {
      if (info.format === "cloudflareos.app") {
        // Приложение: право на узел — из Mnemos; сохранять из Telegram нечего, хранилище не нужно.
        let { binding } = await this.document.app();
        if (binding) {
          let port = await this.#port(binding.accountId);
          let access = await port.writes.appAccess(binding.scope, binding.resource, false);
          mnemos = { kind: "bound", access: access.access === "edit" ? "write" : "read", savedHead: null, savedRevision: null };
        }
      } else if (state.binding) {
        let port = await this.#port(state.binding.accountId);
        let editor = await port.writes.select(state.binding.scope, state.binding.resource, info.format);
        try {
          mnemos = { kind: "bound", access: await editor.access(), savedHead: state.binding.savedHead ?? null, savedRevision: state.binding.savedRevision ?? null };
        } finally { dispose(editor); }
        storageOrigin = port.storageOrigin;
      } else if (state.project && !state.creation) {
        let port = await this.#port(state.project.accountId);
        mnemos = { kind: "project", projectTitle: state.project.title };
        storageOrigin = port.storageOrigin;
      }
    } catch (error) {
      if (error instanceof Error && error.message === SESSION_ENDED) throw error;
      // Mnemos недоступен или документ закрыт: правка остаётся в беседе, сохранение — на сайте.
      mnemos = { kind: "none" };
    }
    return { title: info.title, format: info.format, accent: miniAppAccent(look.preference, look.deployment), mnemos, storageOrigin, sitePath: info.sitePath };
  }

  async getUiBundle(): Promise<{ jsCode: string } | null> {
    await this.guard.check();
    let live = await this.#live();
    let bundle = live ? await live.getUiBundle() : await this.document.uiBundle();
    return bundle ? { jsCode: bundle.jsCode } : null;
  }

  async connectEditor() {
    await this.guard.check();
    if (await this.#anyFormat() === "cloudflareos.app") {
      // Приложение: методы — его собственные, поэтому пропускаются любые, но каждый — после проверки сессии.
      let live = await this.#live();
      return miniAppGadgetGate(this.guard, live ? await live.connectToGadget() : await this.document.editor());
    }
    return new MiniAppEditorGate(this.guard, this.document.editor() as Promise<EditorStub>);
  }

  async writer() {
    await this.guard.check();
    await this.#formatOf();
    let binding = await this.#binding();
    let port = await this.#port(binding.accountId);
    let editor = await port.writes.select(binding.scope, binding.resource, await this.#formatOf());
    try {
      if (await editor.access() === "read") throw new Error("Документ открыт вам только для чтения.");
    } catch (error) { dispose(editor); throw error; }
    return new MiniAppWriterImpl(this.guard, editor, binding, this.document);
  }

  async creator(name: string) {
    await this.guard.check();
    await this.#formatOf();
    if (typeof name !== "string" || !name.trim() || name.length > 255) throw new Error("Invalid document name.");
    let state = await this.document.mnemosState();
    let project = state.project;
    if (state.binding || state.creation || !project) throw new Error("Сохранить в проект из Telegram нельзя: откройте документ на сайте.");
    let port = await this.#port(project.accountId);
    let claim = await this.document.claimMnemosDocument(project.accountId, project.projectId, name, MINI_APP_HOLDER);
    if (!claim) throw new Error("Документ уже сохраняется в Mnemos.");
    let creator: MnemosCreator;
    let head: string;
    try {
      creator = await port.writes.create(project.projectId, claim.name, await this.#formatOf());
      head = await creator.head();
    } catch (error) {
      await this.document.releaseMnemosDocument(claim.claim).catch(() => {});
      throw error;
    }
    return new MiniAppCreatorImpl(this.guard, creator, head, claim.claim, { accountId: project.accountId, scope: project.projectId }, this.document);
  }

  async versions(cursor: string): Promise<{ versions: MiniAppVersion[]; nextCursor: string }> {
    await this.guard.check();
    await this.#formatOf();
    if (typeof cursor !== "string" || cursor.length > 4096) throw new Error("Invalid cursor.");
    let binding = await this.#binding();
    let port = await this.#port(binding.accountId);
    let format = await this.#formatOf();
    let page = await port.downloads.publications(binding.scope, binding.resource, cursor);
    return {
      versions: page.publications.filter(p => p.format === format).map(p => ({
        id: p.id, recordedAt: p.recordedAt || "", author: p.author || p.actor || "", onBehalfOf: p.onBehalfOf || "",
      })),
      nextCursor: page.nextCursor || "",
    };
  }

  async version(id: string) {
    await this.guard.check();
    await this.#formatOf();
    if (typeof id !== "string" || !id || id.length > 300) throw new Error("Invalid version.");
    let binding = await this.#binding();
    let port = await this.#port(binding.accountId);
    return new MiniAppVersionImpl(this.guard, await port.downloads.select(binding.scope, binding.resource, id));
  }
}

/** Сохранение одного документа: проект и документ заданы привязкой, страница их не выбирает. */
@validateRpc()
class MiniAppWriterImpl extends RpcTarget {
  constructor(private guard: SessionGuard, private editor: MnemosEditor, private binding: NativeMnemosBinding, private document: MiniAppDocumentPort) { super(); }
  [Symbol.dispose]() { dispose(this.editor); }

  async head(): Promise<string> {
    await this.guard.check();
    return this.editor.head();
  }

  async issue(expectedHead: string, size: number, checksum: string): Promise<GatekeeperUploadTicket> {
    await this.guard.check();
    return this.editor.issue(expectedHead, size, checksum);
  }

  async save(expectedHead: string, uploadId: string, revision: number | null): Promise<string> {
    await this.guard.check();
    if (revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) throw new Error("Invalid revision.");
    let head = await this.editor.save(expectedHead, uploadId);
    // Отметка «сохранено» — только у того же документа: привязку могли сменить на сайте.
    let current = (await this.document.mnemosState()).binding;
    if (current && current.scope === this.binding.scope && current.resource === this.binding.resource && current.accountId === this.binding.accountId && /^[a-f0-9]{64}$/.test(head)) {
      let { savedRevision: _r, savedHead: _h, ...identity } = current;
      await this.document.setMnemosDocument({ ...identity, savedHead: head, ...(revision !== null ? { savedRevision: revision } : {}) });
    }
    return head;
  }
}

/** Первое сохранение в проект беседы; проект выбран сервером по беседе. */
@validateRpc()
class MiniAppCreatorImpl extends RpcTarget {
  #receipt = false;
  #done = false;
  constructor(private guard: SessionGuard, private creator: MnemosCreator, private head: string, private claim: string,
      private place: { accountId: number; scope: string }, private document: MiniAppDocumentPort) { super(); }
  [Symbol.dispose]() {
    dispose(this.creator);
    // Ничего не отправлено: захват снимается, следующая попытка (здесь или на сайте) идёт сразу.
    if (!this.#receipt && !this.#done) void this.document.releaseMnemosDocument(this.claim).catch(() => {});
  }

  async issue(size: number, checksum: string): Promise<GatekeeperUploadTicket> {
    await this.guard.check();
    return this.creator.issue(this.head, size, checksum);
  }

  async save(uploadId: string, revision: number | null): Promise<void> {
    await this.guard.check();
    if (revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) throw new Error("Invalid revision.");
    let receipt = await this.creator.checkpoint(this.head, uploadId);
    await this.document.recordMnemosDocumentReceipt(this.claim, receipt);
    this.#receipt = true;
    let saved = await this.creator.save(this.head, uploadId);
    let resource = await this.creator.document();
    await this.document.setMnemosDocument({ accountId: this.place.accountId, scope: this.place.scope, resource,
      ...(revision !== null ? { savedRevision: revision } : {}), ...(/^[a-f0-9]{64}$/.test(saved) ? { savedHead: saved } : {}) });
    this.#done = true;
  }
}

/** Одна версия документа: выбрана по привязке и опознавателю, другой документ ей не открыть. */
@validateRpc()
class MiniAppVersionImpl extends RpcTarget {
  constructor(private guard: SessionGuard, private download: MnemosDownload) { super(); }
  [Symbol.dispose]() { dispose(this.download); }
  async issue(): Promise<GatekeeperDownloadTicket & { content_type: string }> {
    await this.guard.check();
    let ticket = await this.download.issue();
    return { url: ticket.url, method: ticket.method, size_bytes: ticket.size_bytes, sha256_hex: ticket.sha256_hex, content_type: ticket.content_type };
  }
  async validate(): Promise<void> {
    await this.guard.check();
    await this.download.validate();
  }
}

type EditorStub = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Связь с сервером редактора: только методы из MINI_APP_EDITOR_METHODS, сессия проверяется.
 *  Методы объявлены явно: общий «вызвать метод по имени» дал бы странице выбрать любой метод. */
class MiniAppEditorGate extends RpcTarget {
  #guard: SessionGuard;
  #editor: Promise<EditorStub>;
  constructor(guard: SessionGuard, editor: Promise<EditorStub>) {
    super();
    this.#guard = guard; this.#editor = editor;
    editor.catch(() => {});
  }
  [Symbol.dispose]() { void this.#editor.then(dispose, () => {}); }
  async #call(method: typeof MINI_APP_EDITOR_METHODS[number], args: unknown[]): Promise<unknown> {
    await this.#guard.recent();
    return (await this.#editor)[method](...args);
  }
  subscribe(...args: unknown[]) { return this.#call("subscribe", args); }
  applyOperation(...args: unknown[]) { return this.#call("applyOperation", args); }
  initializeBlocks(...args: unknown[]) { return this.#call("initializeBlocks", args); }
  exportDocumentSnapshot(...args: unknown[]) { return this.#call("exportDocumentSnapshot", args); }
  updatePresence(...args: unknown[]) { return this.#call("updatePresence", args); }
  leavePresence(...args: unknown[]) { return this.#call("leavePresence", args); }
  getDeck(...args: unknown[]) { return this.#call("getDeck", args); }
  getUndoState(...args: unknown[]) { return this.#call("getUndoState", args); }
  mutateDocument(...args: unknown[]) { return this.#call("mutateDocument", args); }
  updateBlockText(...args: unknown[]) { return this.#call("updateBlockText", args); }
  getDocument(...args: unknown[]) { return this.#call("getDocument", args); }
  restoreDocumentSnapshot(...args: unknown[]) { return this.#call("restoreDocumentSnapshot", args); }
}

/** Связь с сервером приложения в Mini App: любой метод гаджета, но перед каждым — проверка сессии. */
function miniAppGadgetGate(guard: SessionGuard, session: unknown): unknown {
  let target = session as Record<string, unknown>;
  return new Proxy(new RpcTarget() as unknown as Record<string | symbol, unknown>, {
    get(self, property, receiver) {
      if (typeof property === "symbol") return property === Symbol.dispose ? () => dispose(session) : Reflect.get(self, property, receiver);
      if (property === "then" || property === "constructor") return undefined;
      return async (...args: unknown[]) => {
        await guard.recent();
        let method = target[property];
        if (typeof method !== "function") throw new Error(`Нет метода ${property}.`);
        return Reflect.apply(method as (...a: unknown[]) => unknown, target, args);
      };
    },
  });
}

/** Для тестов: только перечисленные методы видны у связи с редактором. */
export function editorGateMethods(): string[] {
  return Object.getOwnPropertyNames(MiniAppEditorGate.prototype).filter(name => name !== "constructor");
}
