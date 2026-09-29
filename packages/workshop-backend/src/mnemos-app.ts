// Экземпляр приложения узла Mnemos (ADR 0028 Mnemos, этап 2).
//
// Почему отдельный Durable Object, а не facet рабочего места беседы: рабочее место принадлежит одному
// человеку (или беседе), а совместное приложение принадлежит узлу проекта, и его открывают люди из
// разных рабочих мест. Объект с ключом [организация, проект, узел] даёт ровно один экземпляр и одну базу
// SQLite на узел и не перезапускается, когда кто-то правит код в своей беседе: предпросмотр правок идёт
// facet'ом рабочего места правящего, то есть отдельным экземпляром со своей базой.
//
// Два вида объектов:
// - общий (ключ без человека) — только совместные приложения и только опубликованные версии узла:
//   личная версия (черновик участника) в общий экземпляр не попадает, иначе участник с правом записи
//   запустил бы свой код на данных всех в обход публикации и согласования;
// - свой (ключ с principal человека) — приложение без совместной работы: у каждого свой экземпляр.
//
// Сервер гаджета (server.js узла) исполняется facet'ом через LOADER без сети и без привязок. Общий
// экземпляр отдаёт странице только то, что вернул session(caller), и никогда сам объект Gadget: иначе
// страница звала бы его методы напрямую с любым principal.
//
// Сюда не ходят из браузера: объект зовёт только связь оболочки (mnemos-app-api.ts), которая проверяет
// права Mnemos при открытии и на каждом вызове. Проверки, от которых зависят данные всех (вид версии,
// «экземпляр пуст»), объект делает сам и одним шагом.

import { DurableObject, RpcStub as NativeRpcStub, RpcTarget as NativeRpcTarget } from "cloudflare:workers";
import { gadgetAppSha256, parseGadgetAppText, type GadgetAppCaller, type GadgetAppDirectory } from "@gadgets/workshop-shared/gadget-app";
import { createWorkshopLogger } from "./observability";

const logger = createWorkshopLogger("workshop.mnemos-app");

/** Имя facet'а с сервером гаджета; одно на объект. */
const FACET = "app";
/** Кусок текста кода в хранилище: значения ключей ограничены, код бывает до 3 МиБ. */
const CHUNK_CHARS = 256 * 1024;
/** Сколько последних записей журнала хранит объект. */
export const AUDIT_KEEP = 500;

export const APP_PUBLISHED_ONLY = "В общем экземпляре работает только опубликованная версия приложения. Опубликуйте её, как документ.";
export const APP_ALREADY_RUNNING = "Приложение уже запущено: сменить версию может только тот, у кого есть право правки файла.";

/** preview — предпросмотр совместного приложения у того, кто правит файл: своя пустая база, любая версия. */
export type AppObjectKind = "shared" | "personal" | "preview";

/** Работающая версия: какой узел, какая версия, кто и когда запустил. */
export type DeployedApp = {
  version: string;
  sha256: string;
  title: string;
  collaborative: boolean;
  session: boolean;
  permissions: string[];
  chunks: number;
  deployedAt: string;
  deployedBy: string;
};

/** Кого видит тот, кто запустил работающую версию: справочник общего экземпляра не шире этого. */
export type DirectoryScope = { people: string[]; units: string[] };

export type DeployOptions = {
  kind: AppObjectKind;
  /** true — запуск без права правки: только в пустой экземпляр (проверка и запись одним шагом). */
  onlyIfEmpty: boolean;
  /** Видимость справочника запустившего с правом правки; null — не менять. */
  directoryScope: DirectoryScope | null;
};

/** Запись журнала: открытия и смены кода. */
export type AppAuditEntry = { at: string; principal: string; action: "open" | "deploy"; version: string };

/** Ключ объекта. Считается только из ответа Mnemos о праве, никогда из ввода страницы. installation —
 *  адрес установки Mnemos: разные установки с совпавшими id не делят экземпляр. owner — principal
 *  человека для своего экземпляра; без него — общий экземпляр узла. */
export function mnemosAppObjectName(installation: string, tenant: string, project: string, node: string, owner?: string): string {
  const parts = owner === undefined ? [installation, tenant, project, node] : [installation, tenant, project, node, owner];
  if (!parts.every(part => typeof part === "string" && part && part.length <= 255)) throw new Error("Invalid app node.");
  return JSON.stringify(owner === undefined ? ["mnemos-app", ...parts] : ["mnemos-app-personal", ...parts]);
}

/** Ключ экземпляра предпросмотра: отдельный вид, данные не пересекаются ни с общим, ни со своим экземпляром. */
export function mnemosAppPreviewName(installation: string, tenant: string, project: string, node: string, owner: string): string {
  const parts = [installation, tenant, project, node, owner];
  if (!parts.every(part => typeof part === "string" && part && part.length <= 255)) throw new Error("Invalid app node.");
  return JSON.stringify(["mnemos-app-preview", ...parts]);
}

/** Ключ объекта, где лежит опубликованная версия оригинала для копий (этап 3). Считается, как и ключ
 *  экземпляра, только из ответа Mnemos о праве. */
export function mnemosAppReleaseName(installation: string, tenant: string, project: string, node: string): string {
  const parts = [installation, tenant, project, node];
  if (!parts.every(part => typeof part === "string" && part && part.length <= 255)) throw new Error("Invalid app node.");
  return JSON.stringify(["mnemos-app-release", ...parts]);
}

/** Опубликованная версия оригинала для копий. Код лежит кусками рядом. */
export type AppRelease = { version: string; sha256: string; title: string; publishedAt: string; authorName: string; recordedAt: string; chunks: number };
export type AppReleaseMeta = Omit<AppRelease, "chunks">;

/** Связь копии с оригиналом: хранится в своём экземпляре копии у её владельца. */
export type AppOrigin = {
  installation: string; tenant: string; project: string; node: string;
  /** Версия оригинала, стоящая в копии, и её сумма. */
  version: string; sha256: string;
  title: string; authorName: string; copiedAt: string; updatedAt: string;
  /** Версия, по которой человек нажал «Не сейчас»; пусто — нет. */
  dismissed: string;
};

/** Где лежит копия человека: хранится в его своём экземпляре оригинала. */
export type AppCopyLink = { project: string; node: string };

export const APP_RELEASE_OLDER = "Версия для копий уже новее.";

/** Справочник общего экземпляра: пересечение видимого открывшему и запустившему. */
export function intersectDirectory(directory: GadgetAppDirectory, scope: DirectoryScope | null): GadgetAppDirectory {
  if (!scope) return { people: [], departments: [] };
  const people = new Set(scope.people), units = new Set(scope.units);
  return {
    people: directory.people.filter(p => people.has(p.id)),
    departments: directory.departments.filter(u => units.has(u.id)).map(u => ({ ...u, members: u.members.filter(m => people.has(m.id)) })),
  };
}

type Meta = Omit<DeployedApp, "chunks">;

export class MnemosAppDurableObject extends DurableObject<Cloudflare.Env> {
  #kv() { return this.ctx.storage.kv; }

  /** Что сейчас работает; null — ни одной версии ещё не запускали. */
  async state(): Promise<{ deployed: Meta | null }> {
    const deployed = this.#kv().get<DeployedApp>("deployed");
    if (!deployed) return { deployed: null };
    const { chunks: _chunks, ...meta } = deployed;
    return { deployed: meta };
  }

  /**
   * Запустить версию узла. Текст проверяется строго ещё раз и сверяется с суммой, которую оболочка
   * получила от Mnemos. Вид версии и «экземпляр пуст» проверяются здесь, без ожиданий до записи.
   */
  async deploy(version: string, sha256: string, text: string, by: string, options: DeployOptions): Promise<Meta> {
    if (typeof version !== "string" || !version || version.length > 300 || !/^[a-f0-9]{64}$/.test(sha256) || typeof by !== "string" || !by) throw new Error("Invalid deployment.");
    if (options.kind !== "shared" && options.kind !== "personal" && options.kind !== "preview") throw new Error("Invalid deployment.");
    const envelope = parseGadgetAppText(text);
    if (await gadgetAppSha256(text) !== sha256) throw new Error("Код приложения не совпадает с версией в Mnemos.");
    const manifest = envelope.document.manifest;
    if (options.kind === "shared") {
      if (version.startsWith("private:")) throw new Error(APP_PUBLISHED_ONLY);
      if (!manifest.collaborative || !manifest.session) throw new Error("Приложение не совместное: общий экземпляр ему не нужен.");
    } else if (options.kind === "preview") {
      if (!manifest.collaborative || !manifest.session) throw new Error("Предпросмотр нужен только совместному приложению.");
    } else if (manifest.collaborative) throw new Error("Совместное приложение работает общим экземпляром.");
    // Ниже нет ожиданий: проверки и запись идут одним шагом объекта.
    const kv = this.#kv();
    const kind = kv.get<string>("kind");
    if (kind && kind !== options.kind) throw new Error("Invalid deployment.");
    const previous = kv.get<DeployedApp>("deployed");
    if (options.onlyIfEmpty && previous) throw new Error(APP_ALREADY_RUNNING);
    kv.put("kind", options.kind);
    const chunks = Math.ceil(text.length / CHUNK_CHARS);
    for (let i = 0; i < chunks; i++) kv.put(`code:${sha256}:${i}`, text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS));
    const deployed: DeployedApp = {
      version, sha256, title: manifest.title, collaborative: manifest.collaborative, session: manifest.session,
      permissions: [...manifest.permissions], chunks, deployedAt: new Date().toISOString(), deployedBy: by,
    };
    kv.put("deployed", deployed);
    if (options.directoryScope) kv.put("directoryScope", { people: [...options.directoryScope.people], units: [...options.directoryScope.units] } satisfies DirectoryScope);
    if (previous && previous.sha256 !== sha256) for (let i = 0; i < previous.chunks; i++) kv.delete(`code:${previous.sha256}:${i}`);
    this.#audit(by, "deploy", version);
    if (!previous || previous.sha256 !== sha256) this.ctx.facets.abort(FACET, new Error("Приложение обновлено до новой версии."));
    logger.info("mnemos app deployed", { event: "mnemos_app.deploy", appVersion: version, operation: sha256 });
    const { chunks: _chunks, ...meta } = deployed;
    return meta;
  }

  /** Код экрана работающей версии. */
  async uiBundle(): Promise<{ jsCode: string } | null> {
    const deployed = this.#kv().get<DeployedApp>("deployed");
    if (!deployed) return null;
    return { jsCode: this.#read(deployed).document.modules["client.js"] };
  }

  /**
   * Связь одного человека с сервером гаджета: то, что вернул session(caller). Сам объект Gadget отдаётся
   * только своему экземпляру приложения без session() — там нет чужих данных.
   */
  async session(caller: GadgetAppCaller): Promise<unknown> {
    const deployed = this.#kv().get<DeployedApp>("deployed");
    if (!deployed) throw new Error("Приложение ещё не запущено: откройте его версию.");
    const shared = this.#kv().get<AppObjectKind>("kind") === "shared";
    const checked: GadgetAppCaller = { principal: caller.principal, name: caller.name, access: caller.access,
      ...(caller.directory && deployed.permissions.includes("directory")
        ? { directory: shared ? intersectDirectory(caller.directory, this.#kv().get<DirectoryScope>("directoryScope") ?? null) : caller.directory } : {}) };
    this.#audit(caller.principal, "open", deployed.version);
    const facet = this.#facet(deployed);
    if (deployed.session) return (facet as unknown as { session(caller: GadgetAppCaller): Promise<unknown> }).session(checked);
    if (shared) throw new Error("Общий экземпляр открывается только через session(caller).");
    return facetStub(facet);
  }

  // ─── Копии (этап 3) ───────────────────────────────────────────────────────────────────────────
  // Три вида записей в разных объектах: версия для копий — в объекте оригинала вида "release";
  // связь копии с оригиналом — в своём экземпляре копии; где лежит копия — в своём экземпляре
  // оригинала у получателя. Вид объекта не смешивается: версия для копий не запускается как
  // экземпляр, а экземпляр не хранит версию для копий.

  #requireKind(kind: "release" | "personal") {
    const current = this.#kv().get<string>("kind");
    if (current && current !== kind) throw new Error("Invalid app object.");
    this.#kv().put("kind", kind);
  }

  /** Версия для копий без кода; null — ещё не записана. */
  async release(): Promise<AppReleaseMeta | null> {
    const release = this.#kv().get<AppRelease>("release");
    if (!release) return null;
    const { chunks: _chunks, ...meta } = release;
    return meta;
  }

  /**
   * Записать опубликованную версию оригинала для копий. Текст проверяется строго и сверяется с
   * суммой из Mnemos; личные версии и совместные приложения — отказ; более старая публикация не
   * заменяет более новую (два человека могли прочитать историю в разное время).
   */
  async setRelease(version: string, sha256: string, text: string, publishedAt: string, authorName: string): Promise<AppReleaseMeta> {
    const actual = typeof text === "string" ? await gadgetAppSha256(text) : "";
    if (typeof version !== "string" || !version || version.length > 300 || version.startsWith("private:") || !/^[a-f0-9]{64}$/.test(sha256) ||
        typeof publishedAt !== "string" || publishedAt.length > 64 || typeof authorName !== "string" || authorName.length > 255) throw new Error("Invalid release.");
    const manifest = parseGadgetAppText(text).document.manifest;
    if (actual !== sha256) throw new Error("Код приложения не совпадает с версией в Mnemos.");
    if (manifest.collaborative) throw new Error("Совместное приложение не копируется: им делятся доступом к общему экземпляру.");
    // Ниже нет ожиданий: проверка порядка и запись идут одним шагом объекта.
    const kv = this.#kv();
    const previous = kv.get<AppRelease>("release");
    if (previous && previous.version === version && previous.sha256 === sha256) { const { chunks: _c, ...meta } = previous; return meta; }
    if (previous && Date.parse(previous.publishedAt) > Date.parse(publishedAt)) throw new Error(APP_RELEASE_OLDER);
    this.#requireKind("release");
    const chunks = Math.ceil(text.length / CHUNK_CHARS);
    for (let i = 0; i < chunks; i++) kv.put(`release:${sha256}:${i}`, text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS));
    const release: AppRelease = { version, sha256, title: manifest.title, publishedAt, authorName, recordedAt: new Date().toISOString(), chunks };
    kv.put("release", release);
    if (previous && previous.sha256 !== sha256) for (let i = 0; i < previous.chunks; i++) kv.delete(`release:${previous.sha256}:${i}`);
    logger.info("mnemos app release", { event: "mnemos_app.release", appVersion: version, operation: sha256 });
    const { chunks: _chunks, ...meta } = release;
    return meta;
  }

  /** Версия для копий вместе с кодом; сумма сверяется ещё раз. */
  async releaseText(): Promise<{ release: AppReleaseMeta; text: string } | null> {
    const release = this.#kv().get<AppRelease>("release");
    if (!release) return null;
    let text = "";
    for (let i = 0; i < release.chunks; i++) {
      const chunk = this.#kv().get<string>(`release:${release.sha256}:${i}`);
      if (typeof chunk !== "string") throw new Error("Код приложения в хранилище повреждён.");
      text += chunk;
    }
    if (await gadgetAppSha256(text) !== release.sha256) throw new Error("Код приложения в хранилище повреждён.");
    const { chunks: _chunks, ...meta } = release;
    return { release: meta, text };
  }

  /** Связь копии с оригиналом; null — узел не копия. */
  async origin(): Promise<AppOrigin | null> { return this.#kv().get<AppOrigin>("origin") ?? null; }

  async setOrigin(origin: AppOrigin): Promise<void> {
    const text = (value: unknown, max = 300) => typeof value === "string" && value.length <= max;
    if (!origin || ![origin.installation, origin.tenant, origin.project, origin.node, origin.version].every(v => text(v) && v) ||
        !/^[a-f0-9]{64}$/.test(origin.sha256) || ![origin.title, origin.authorName, origin.copiedAt, origin.updatedAt, origin.dismissed].every(v => text(v))) throw new Error("Invalid origin.");
    this.#requireKind("personal");
    this.#kv().put("origin", {
      installation: origin.installation, tenant: origin.tenant, project: origin.project, node: origin.node, version: origin.version, sha256: origin.sha256,
      title: origin.title, authorName: origin.authorName, copiedAt: origin.copiedAt, updatedAt: origin.updatedAt, dismissed: origin.dismissed,
    } satisfies AppOrigin);
  }

  /** «Сделать своей»: связь с оригиналом снимается, обновления автора больше не предлагаются. Откуда
   *  копия была сделана, остаётся записью «owned» (только для разбора, шапка её не читает). */
  async clearOrigin(at: string): Promise<void> {
    const origin = this.#kv().get<AppOrigin>("origin");
    if (!origin || typeof at !== "string" || at.length > 64) throw new Error("Invalid origin.");
    this.#kv().put("owned", { project: origin.project, node: origin.node, version: origin.version, sha256: origin.sha256, at });
    this.#kv().delete("origin");
  }

  /** «Не сейчас» для одной версии оригинала. */
  async dismissUpdate(version: string): Promise<void> {
    const origin = this.#kv().get<AppOrigin>("origin");
    if (!origin || typeof version !== "string" || !version || version.length > 300) throw new Error("Invalid origin.");
    this.#kv().put("origin", { ...origin, dismissed: version });
  }

  /** Копия человека, сделанная из этого оригинала; null — копии нет. */
  async copyLink(): Promise<AppCopyLink | null> { return this.#kv().get<AppCopyLink>("copy") ?? null; }

  async setCopyLink(link: AppCopyLink): Promise<void> {
    if (!link || typeof link.project !== "string" || typeof link.node !== "string" || !link.project || !link.node || link.project.length > 255 || link.node.length > 255) throw new Error("Invalid copy.");
    this.#requireKind("personal");
    this.#kv().put("copy", { project: link.project, node: link.node } satisfies AppCopyLink);
  }

  /** Последние записи журнала, новые сверху. */
  async audit(limit = 50): Promise<AppAuditEntry[]> {
    const entries = [...this.#kv().list<AppAuditEntry>({ prefix: "audit:", reverse: true, limit: Math.max(1, Math.min(limit, AUDIT_KEEP)) })];
    return entries.map(([, value]) => value);
  }

  #audit(principal: string, action: AppAuditEntry["action"], version: string) {
    const kv = this.#kv();
    const sequence = (kv.get<number>("auditSequence") ?? 0) + 1;
    kv.put("auditSequence", sequence);
    kv.put(`audit:${String(sequence).padStart(12, "0")}`, { at: new Date().toISOString(), principal, action, version } satisfies AppAuditEntry);
    if (sequence > AUDIT_KEEP) kv.delete(`audit:${String(sequence - AUDIT_KEEP).padStart(12, "0")}`);
    logger.info("mnemos app audit", { event: `mnemos_app.${action}`, principal, appVersion: version });
  }

  #read(deployed: DeployedApp) {
    let text = "";
    for (let i = 0; i < deployed.chunks; i++) {
      const chunk = this.#kv().get<string>(`code:${deployed.sha256}:${i}`);
      if (typeof chunk !== "string") throw new Error("Код приложения в хранилище повреждён.");
      text += chunk;
    }
    return parseGadgetAppText(text);
  }

  #facet(deployed: DeployedApp): Fetcher<DurableObject> {
    return this.ctx.facets.get<DurableObject>(FACET, () => {
      const server = this.#read(deployed).document.modules["server.js"];
      // Ключ загрузчика — сумма кода: одна версия грузится один раз, новая версия — новый рабочий код.
      const worker = this.env.LOADER.get(`mnemos-app.${this.ctx.id}.${deployed.sha256}`, () => ({
        compatibilityDate: "2026-02-01",
        compatibilityFlags: ["allow_irrevocable_stub_storage"],
        mainModule: "server.js",
        modules: { "server.js": server },
        env: {},
        // Без сети: данные извне — только через Mnemos с правами человека.
        globalOutbound: null,
      }));
      return { class: worker.getDurableObjectClass<any>("Gadget"), id: FACET };
    });
  }
}

/** Заглушка facet'а в виде объекта RPC (как в OverseerImpl.getGadgetFacet): только для своего экземпляра. */
function facetStub(facet: Fetcher<DurableObject>): unknown {
  const proxy = new Proxy(facet, {
    get(target, prop) {
      const method = Reflect.get(target, prop, target);
      if (typeof method !== "function" || typeof prop === "symbol") return method;
      return (...args: unknown[]) => Reflect.apply(method, target, args);
    },
    getPrototypeOf() { return NativeRpcTarget.prototype; },
  });
  // @ts-expect-error NativeRpcStub still has infinite recursion problems, fixed in Cap'n Web.
  return new NativeRpcStub(proxy);
}
