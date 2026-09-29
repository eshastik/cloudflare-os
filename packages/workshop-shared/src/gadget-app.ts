// Гаджет как файл проекта Mnemos (ADR 0028 Mnemos, этапы 1–2).
//
// Узел Mnemos с типом содержимого application/vnd.cloudflareos.app+json хранит манифест и два
// собранных модуля: client.js (исполняется во фрейме-песочнице) и server.js (объект гаджета без
// сети). Формат проверяется строго и при записи (браузер перед выгрузкой), и при чтении (сервер
// оболочки перед запуском): лишнее поле, чужой модуль или превышение размера — отказ, а не молчаливая
// обрезка.

/** Опознаватель формата в каталоге версий Mnemos (как `cloudflareos.document` у документа). */
export const GADGET_APP_FORMAT = "cloudflareos.app" as const;
/** Тип содержимого узла Mnemos. */
export const GADGET_APP_MIME = "application/vnd.cloudflareos.app+json" as const;

/** Разрешения, которые гаджет может запросить в манифесте. `directory` — справочник людей и отделов. */
export const GADGET_APP_PERMISSIONS = ["directory"] as const;
export type GadgetAppPermission = typeof GADGET_APP_PERMISSIONS[number];

/** Пределы формата. Весь узел не больше 4 МиБ: столько принимает выгрузка встроенного документа. */
export const GADGET_APP_LIMITS = {
  titleChars: 120,
  descriptionChars: 2000,
  clientBytes: 2 * 1024 * 1024,
  serverBytes: 1024 * 1024,
  totalBytes: 4 * 1024 * 1024,
} as const;

export type GadgetAppManifest = {
  /** Название приложения, одна строка. */
  title: string;
  /** Что делает приложение; может быть пустым. */
  description: string;
  /** true — один экземпляр и одна база на узел, общие для всех, кому открыт узел; false — у каждого свой. */
  collaborative: boolean;
  /** Класс Gadget объявляет session(caller). Обязательно для collaborative: общий экземпляр никогда не
   *  отдаёт странице сам объект Gadget, только то, что вернул session(caller). */
  session: boolean;
  /** Версия формата манифеста. */
  formatVersion: 1;
  /** Нужные приложению возможности оболочки. */
  permissions: GadgetAppPermission[];
};

export type GadgetAppModules = { "client.js": string; "server.js": string };

/** Содержимое узла без конверта: манифест и модули. */
export type GadgetAppDocument = { manifest: GadgetAppManifest; modules: GadgetAppModules };

/** Конверт узла, как у встроенных документов: `{format, formatVersion, document}`. */
export type GadgetAppEnvelope = { format: typeof GADGET_APP_FORMAT; formatVersion: 1; document: GadgetAppDocument };

export class GadgetAppFormatError extends Error {
  constructor(reason: string) { super(`Файл приложения повреждён или в чужом формате: ${reason}.`); this.name = "GadgetAppFormatError"; }
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function exactKeys(value: Record<string, unknown>, keys: readonly string[], where: string) {
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length) throw new GadgetAppFormatError(`лишнее поле ${where}.${extra[0]}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new GadgetAppFormatError(`нет поля ${where}.${key}`);
}

/** Строгая проверка манифеста. Возвращает новую запись без посторонних свойств. */
export function parseGadgetAppManifest(value: unknown): GadgetAppManifest {
  if (!isRecord(value)) throw new GadgetAppFormatError("манифест не объект");
  exactKeys(value, ["title", "description", "collaborative", "session", "formatVersion", "permissions"], "manifest");
  const { title, description, collaborative, session, formatVersion, permissions } = value;
  if (typeof title !== "string" || !title.trim() || title.length > GADGET_APP_LIMITS.titleChars || /[\u0000-\u001f\u007f]/.test(title)) throw new GadgetAppFormatError("название пустое, длинное или многострочное");
  if (typeof description !== "string" || description.length > GADGET_APP_LIMITS.descriptionChars || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) throw new GadgetAppFormatError("описание длинное или с управляющими знаками");
  if (typeof collaborative !== "boolean") throw new GadgetAppFormatError("collaborative не логическое");
  if (typeof session !== "boolean") throw new GadgetAppFormatError("session не логическое");
  if (collaborative && !session) throw new GadgetAppFormatError("общему приложению нужен метод session(caller)");
  if (formatVersion !== 1) throw new GadgetAppFormatError("неизвестная версия манифеста");
  if (!Array.isArray(permissions) || permissions.length > GADGET_APP_PERMISSIONS.length || new Set(permissions).size !== permissions.length ||
      permissions.some(p => !(GADGET_APP_PERMISSIONS as readonly unknown[]).includes(p))) throw new GadgetAppFormatError("неизвестное или повторённое разрешение");
  return { title, description, collaborative, session, formatVersion: 1, permissions: [...permissions] as GadgetAppPermission[] };
}

/** Строгая проверка модулей: ровно client.js и server.js, непустые строки в пределах размеров. */
export function parseGadgetAppModules(value: unknown): GadgetAppModules {
  if (!isRecord(value)) throw new GadgetAppFormatError("модули не объект");
  exactKeys(value, ["client.js", "server.js"], "modules");
  const client = value["client.js"], server = value["server.js"];
  if (typeof client !== "string" || !client.trim() || utf8Bytes(client) > GADGET_APP_LIMITS.clientBytes) throw new GadgetAppFormatError("client.js пустой или больше 2 МиБ");
  if (typeof server !== "string" || !server.trim() || utf8Bytes(server) > GADGET_APP_LIMITS.serverBytes) throw new GadgetAppFormatError("server.js пустой или больше 1 МиБ");
  return { "client.js": client, "server.js": server };
}

/** Строгая проверка содержимого узла (без конверта). */
export function parseGadgetAppDocument(value: unknown): GadgetAppDocument {
  if (!isRecord(value)) throw new GadgetAppFormatError("содержимое не объект");
  exactKeys(value, ["manifest", "modules"], "document");
  return { manifest: parseGadgetAppManifest(value.manifest), modules: parseGadgetAppModules(value.modules) };
}

/** Строгая проверка конверта узла. */
export function parseGadgetAppEnvelope(value: unknown): GadgetAppEnvelope {
  if (!isRecord(value)) throw new GadgetAppFormatError("файл не объект");
  exactKeys(value, ["format", "formatVersion", "document"], "file");
  if (value.format !== GADGET_APP_FORMAT) throw new GadgetAppFormatError("чужой формат");
  if (value.formatVersion !== 1) throw new GadgetAppFormatError("неизвестная версия файла");
  return { format: GADGET_APP_FORMAT, formatVersion: 1, document: parseGadgetAppDocument(value.document) };
}

/** Разбор текста узла в том виде, как он лежит в Mnemos. */
export function parseGadgetAppText(text: string): GadgetAppEnvelope {
  if (typeof text !== "string" || utf8Bytes(text) > GADGET_APP_LIMITS.totalBytes) throw new GadgetAppFormatError("файл больше 4 МиБ");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new GadgetAppFormatError("не JSON"); }
  return parseGadgetAppEnvelope(value);
}

/** Текст узла: один канонический порядок полей, чтобы одна и та же версия давала одну и ту же сумму. */
export function gadgetAppText(document: GadgetAppDocument): string {
  const checked = parseGadgetAppDocument(document);
  const text = JSON.stringify({
    format: GADGET_APP_FORMAT, formatVersion: 1,
    document: {
      manifest: { title: checked.manifest.title, description: checked.manifest.description, collaborative: checked.manifest.collaborative, session: checked.manifest.session, formatVersion: 1, permissions: checked.manifest.permissions },
      modules: { "client.js": checked.modules["client.js"], "server.js": checked.modules["server.js"] },
    },
  });
  if (utf8Bytes(text) > GADGET_APP_LIMITS.totalBytes) throw new GadgetAppFormatError("файл больше 4 МиБ");
  return text;
}

/** SHA-256 текста узла шестнадцатеричной строкой (как sha256_hex в билетах Mnemos). */
export async function gadgetAppSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Привязка гаджета рабочего места к узлу ─────────────────────────────────────────────────────

/** Узел Mnemos, к которому привязан гаджет рабочего места у одного человека. */
export type MnemosAppBinding = {
  /** Подключение Mnemos человека. */
  accountId: number;
  /** Проект. */
  scope: string;
  /** Узел приложения в проекте. */
  resource: string;
  /** Поля манифеста, кроме названия (название — у гаджета). */
  description: string;
  collaborative: boolean;
  session: boolean;
  permissions: GadgetAppPermission[];
  /** Версия кода рабочего места, совпавшая с последним сохранением или открытием; нет — кода приложения в
   *  рабочем месте нет (открывший без права правки получает только экран общего или своего экземпляра). */
  savedCodeVersion?: number;
  /** Голова ветки, от которой правит рабочее место (личная версия); сохранение сверяется с ней. */
  savedHead?: string;
  /** Версия узла (id публикации), с которой совпал код при последнем открытии или сохранении. */
  savedVersion?: string;
};

/** Строгая проверка привязки на границе RPC. */
export function parseMnemosAppBinding(value: unknown): MnemosAppBinding {
  if (!isRecord(value)) throw new Error("Invalid app binding.");
  const allowed = ["accountId", "scope", "resource", "description", "collaborative", "session", "permissions", "savedCodeVersion", "savedHead", "savedVersion"];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Invalid app binding.");
  const { accountId, scope, resource, savedCodeVersion, savedHead, savedVersion } = value;
  const text = (v: unknown) => typeof v === "string" && !!v && v.length <= 255;
  if (!Number.isSafeInteger(accountId) || !text(scope) || !text(resource)) throw new Error("Invalid app binding.");
  if (savedCodeVersion !== undefined && (!Number.isSafeInteger(savedCodeVersion) || (savedCodeVersion as number) < 0)) throw new Error("Invalid app binding.");
  if (savedHead !== undefined && (typeof savedHead !== "string" || !/^[a-f0-9]{64}$/.test(savedHead))) throw new Error("Invalid app binding.");
  if (savedVersion !== undefined && (typeof savedVersion !== "string" || !savedVersion || savedVersion.length > 300)) throw new Error("Invalid app binding.");
  const manifest = parseGadgetAppManifest({ title: "x", description: value.description, collaborative: value.collaborative, session: value.session, formatVersion: 1, permissions: value.permissions });
  return {
    accountId: accountId as number, scope: scope as string, resource: resource as string,
    description: manifest.description, collaborative: manifest.collaborative, session: manifest.session, permissions: manifest.permissions,
    ...(savedCodeVersion !== undefined ? { savedCodeVersion: savedCodeVersion as number } : {}),
    ...(savedHead !== undefined ? { savedHead: savedHead as string } : {}),
    ...(savedVersion !== undefined ? { savedVersion: savedVersion as string } : {}),
  };
}

/** Что знает рабочее место о приложении для текущего человека. */
export type MnemosAppState = {
  binding: MnemosAppBinding | null;
  /** Текущая версия кода рабочего места: сверяется с savedCodeVersion. */
  codeVersion: number;
  /** Название гаджета — название приложения. */
  title: string;
  /** null — код можно сохранить в проект; иначе — почему нельзя. */
  notExportable: string | null;
};

// ─── Вызывающий: API для кода гаджета ───────────────────────────────────────────────────────────

/** Право вызывающего на узел приложения. */
export type GadgetAppAccess = "read" | "edit";

/** Человек или отдел справочника; id — служебный ключ человека (principal Mnemos), не для показа. */
export type GadgetAppPerson = { id: string; name: string };
export type GadgetAppDepartment = { id: string; name: string; members: GadgetAppPerson[] };

/**
 * Справочник людей и отделов организации: снимок на момент открытия связи. Есть у вызывающего, только
 * если манифест просит разрешение `directory`. В общем экземпляре — только то, что видят одновременно
 * открывший и тот, кто запустил работающую версию (пересечение): код приложения не узнаёт о людях
 * больше, чем видит его запустивший. В своём экземпляре — справочник открывшего.
 */
export type GadgetAppDirectory = { people: GadgetAppPerson[]; departments: GadgetAppDepartment[] };

/**
 * Кто вызывает сервер гаджета. Оболочка передаёт это в `session(caller)` класса `Gadget` один раз на
 * связь. Право проверено оболочкой по Mnemos при открытии и не реже раза в 30 с; смена права или
 * отзыв доступа закрывают связь, а новое открытие приходит с новым `caller`. Все поля — данные, без
 * ссылок RPC: объект можно хранить сколько угодно.
 *
 * В предпросмотре правок (рабочее место беседы) `principal` — `workspace:<id пользователя оболочки>`,
 * право — `edit`, справочника нет: данные предпросмотра отдельные и в живой экземпляр не попадают.
 */
export type GadgetAppCaller = {
  /** Principal Mnemos человека: устойчивый ключ для разделения данных по людям. */
  principal: string;
  /** Имя человека для показа. */
  name: string;
  /** Право на узел приложения: чтение или правка. */
  access: GadgetAppAccess;
  /** Справочник, если в манифесте есть разрешение `directory`. */
  directory?: GadgetAppDirectory;
};

// ─── Связь браузера с живым экземпляром ─────────────────────────────────────────────────────────

/** Что знает оболочка о приложении при открытии. */
export type MnemosAppInfo = {
  /** Право открывшего на узел. */
  access: GadgetAppAccess;
  /** Открывший: principal и имя. */
  caller: { principal: string; name: string };
  /** Какая версия узла сейчас работает в общем экземпляре; null — ещё ни одной. */
  deployed: { version: string; sha256: string; title: string; collaborative: boolean } | null;
};

/** Манифест версии без кода: оболочка читает его сама, код открывшему без права правки не отдаётся. */
export type MnemosAppManifestInfo = GadgetAppManifest;

/**
 * Связь страницы с общим экземпляром приложения одного узла Mnemos. Права Mnemos проверяются на каждом
 * вызове (не реже раза в 30 с); отзыв закрывает связь.
 */
export interface MnemosAppConnection {
  /** Право и работающая версия. */
  describe(): Promise<MnemosAppInfo>;
  /** Код экрана работающей версии для фрейма-песочницы; null — версии ещё нет. */
  getUiBundle(): Promise<{ jsCode: string } | null>;
  /** Связь с сервером гаджета от имени открывшего. */
  connectToGadget(): Promise<unknown>;
  /** Манифест версии узла; код версии оболочка читает из Mnemos сама и странице не отдаёт. */
  manifest(version: string): Promise<MnemosAppManifestInfo>;
  /**
   * Запустить версию узла. Код читает из Mnemos сама оболочка правами открывшего. Общий экземпляр —
   * только опубликованная версия и только с правом правки; без права правки — лишь первый запуск пустого
   * экземпляра последней опубликованной версией. Свой экземпляр — любая доступная открывшему версия.
   */
  deploy(version: string): Promise<MnemosAppInfo>;
}
