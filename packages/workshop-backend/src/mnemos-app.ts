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

export type AppObjectKind = "shared" | "personal";

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
    if (options.kind !== "shared" && options.kind !== "personal") throw new Error("Invalid deployment.");
    const envelope = parseGadgetAppText(text);
    if (await gadgetAppSha256(text) !== sha256) throw new Error("Код приложения не совпадает с версией в Mnemos.");
    const manifest = envelope.document.manifest;
    if (options.kind === "shared") {
      if (version.startsWith("private:")) throw new Error(APP_PUBLISHED_ONLY);
      if (!manifest.collaborative || !manifest.session) throw new Error("Приложение не совместное: общий экземпляр ему не нужен.");
    } else if (manifest.collaborative) throw new Error("Совместное приложение работает общим экземпляром.");
    // Ниже нет ожиданий: проверки и запись идут одним шагом объекта.
    const kv = this.#kv();
    const kind = kv.get<AppObjectKind>("kind");
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
