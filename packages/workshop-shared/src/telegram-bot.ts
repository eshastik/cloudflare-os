// Личный бот Telegram пользователя оболочки (ADR 0027 Mnemos, этап 1).
// Состояние для экрана «Telegram» в личных настройках: ни токена, ни секрета вебхука здесь нет.

export type TelegramBotIdentity = {
  /** Имя бота без «@». */
  username: string;
  /** Отображаемое имя бота из BotFather. */
  title: string;
};

export type TelegramOwnerIdentity = {
  /** Имя владельца в Telegram, как его показывает Telegram. */
  name: string;
  /** Имя пользователя Telegram без «@», если оно задано. */
  username: string | null;
};

/** Режим тредов бота (BotFather → Bot Settings → Threads Settings), по последнему ответу getMe.
 *  Каждая беседа в Telegram — отдельный тред личного чата, поэтому без него бот не подключается. */
export type TelegramThreads = {
  /** Threaded Mode включён. */
  enabled: boolean;
  /** Пользователю не запрещено создавать треды: новый тред — новая беседа. */
  usersCanCreate: boolean;
};

export type TelegramBotState =
  /** Установка не готова: нет ключа шифрования секретов или публичного адреса. */
  | { status: "unavailable"; reason: "no_key" | "no_public_address" }
  | { status: "none" }
  /** Токен верный, но у бота выключен режим тредов: ничего не сохранено, нужно включить и проверить снова. */
  | { status: "needs_threads"; bot: TelegramBotIdentity; threads: TelegramThreads }
  /** Бот проверен и принимает сообщения, ждём «/start КОД» из Telegram владельца. */
  | { status: "pairing"; bot: TelegramBotIdentity; threads: TelegramThreads; code: string; expiresAt: number }
  | { status: "connected"; bot: TelegramBotIdentity; threads: TelegramThreads; owner: TelegramOwnerIdentity; connectedAt: number };

export function threadsReady(threads: TelegramThreads): boolean {
  return threads.enabled && threads.usersCanCreate;
}

/** Итог отключения: снят ли вебхук у Telegram. Запись о боте удаляется в любом случае. */
export type TelegramDisconnectResult = { webhookRemoved: boolean };

/** Код подключения, который бот ждёт в «/start КОД». */
export const TELEGRAM_PAIRING_CODE = /^[a-z0-9]{12}$/;

/** Беседа сайта и тред Telegram её владельца (ADR 0027, этап 3). */
export type TelegramChatLink =
  /** Бот не подключён или беседа не ваша: переносить некуда. */
  | { status: "unavailable" }
  /** Беседу можно продолжить в Telegram: бот создаст для неё тред. */
  | { status: "available"; bot: string }
  /** Беседа уже идёт в треде; url — чат с ботом (ссылок на тред личного чата Telegram не даёт). */
  | { status: "linked"; bot: string; url: string };

// ---- Уведомления Mnemos (ADR 0027, раздел 5) ----

/** Виды уведомлений в порядке показа в настройках (как в Mnemos, миграция 0176). */
export const NOTIFICATION_KINDS = ["decision_needed", "task_result", "shared_with_me", "platform_failure"] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];

// Последние три — из миграции 0179 Mnemos: без них одно такое событие делало недействительной всю
// страницу очереди, и доставка в Telegram вставала целиком.
export const NOTIFICATION_OBJECT_TYPES = ["publication_review", "share_request", "collaboration", "document", "platform_signal", "inbox_alert", "template_promotion", "project"] as const;
export type NotificationObjectType = typeof NOTIFICATION_OBJECT_TYPES[number];

/** Объект уведомления: только идентификаторы, без адресов. */
export type NotificationObject = {
  type: NotificationObjectType;
  id: string;
  project_id?: string;
  owner_id?: string;
  domain_id?: string;
};

export type MnemosNotification = {
  sequence: number;
  kind: NotificationKind;
  object: NotificationObject;
  summary: string;
  created_at: string;
};

/** Страница очереди. next_after — до какого номера просмотрено (включая скрытые события). */
export type NotificationPage = { items: MnemosNotification[]; next_after: number; delivered: number; more: boolean };

/** Настройки видов для экрана. platformFailure — человеку доступен вид «сбои системы» (администратор). */
export type NotificationSettings = { kinds: Record<NotificationKind, boolean>; platformFailure: boolean };

/** Решение по уведомлению готовится при отправке: version — номер версии объекта, на которую
 *  человек отвечает кнопкой (согласование — decision_version, приёмка — номер результата). null —
 *  кнопкой сейчас не решить (уже решено или решение только на сайте). */
export type NotificationDecisionTicket = { version: number | null; details: string[] };

/** Итог решения кнопкой: принято; объект изменился или уже решён; нужно решать на сайте. */
export type NotificationDecisionResult =
  | { status: "approved" | "rejected" }
  | { status: "stale"; reason: string }
  | { status: "site"; reason: string };

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && value !== "." && value !== ".." && !/[\x00-\x1f\x7f]/.test(value);
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Строгая проверка объекта: состав полей зависит от типа, как в ограничении таблицы Mnemos. */
export function validNotificationObject(value: unknown): NotificationObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let o = value as Record<string, unknown>;
  let type = o.type as NotificationObjectType;
  if (!NOTIFICATION_OBJECT_TYPES.includes(type) || !validId(o.id)) return null;
  let field = (name: string) => o[name] === undefined || o[name] === "" ? undefined : validId(o[name]) ? o[name] as string : null;
  let project = field("project_id"), owner = field("owner_id"), domain = field("domain_id");
  if (project === null || owner === null || domain === null) return null;
  // null — поле необязательно (у вопроса приёма организации проекта нет).
  let shape: Record<NotificationObjectType, [boolean | null, boolean, boolean]> = {
    publication_review: [true, false, true], share_request: [true, false, false], collaboration: [true, false, false],
    document: [true, true, false], platform_signal: [false, false, false],
    inbox_alert: [null, false, false], template_promotion: [false, false, false], project: [true, false, false],
  };
  let [p, w, d] = shape[type];
  if ((p !== null && !!project !== p) || !!owner !== w || !!domain !== d) return null;
  if (type === "project" && project !== o.id) return null;
  return { type, id: o.id, ...(project ? { project_id: project } : {}), ...(owner ? { owner_id: owner } : {}), ...(domain ? { domain_id: domain } : {}) };
}

/** Страница очереди от Mnemos; null — ответ не по контракту. Порядок номеров строго растёт. */
export function validNotificationPage(value: unknown): NotificationPage | null {
  if (!value || typeof value !== "object") return null;
  let page = value as Record<string, unknown>;
  let raw = page.items ?? [];
  if (!Array.isArray(raw) || raw.length > 100 || !positiveInt(page.next_after) || !positiveInt(page.delivered) || typeof page.more !== "boolean") return null;
  let items: MnemosNotification[] = [];
  let last = -1;
  for (let entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    let n = entry as Record<string, unknown>;
    let object = validNotificationObject(n.object);
    if (!positiveInt(n.sequence) || n.sequence <= last || n.sequence > (page.next_after as number) || !NOTIFICATION_KINDS.includes(n.kind as NotificationKind) || !object ||
        typeof n.summary !== "string" || !n.summary.trim() || n.summary.length > 1000 || typeof n.created_at !== "string" || n.created_at.length > 64) return null;
    last = n.sequence;
    items.push({ sequence: n.sequence, kind: n.kind as NotificationKind, object, summary: n.summary, created_at: n.created_at });
  }
  return { items, next_after: page.next_after as number, delivered: page.delivered as number, more: page.more };
}

/** Виды из ответа Mnemos; null — не все четыре вида или лишние поля. */
export function validNotificationKinds(value: unknown): Record<NotificationKind, boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let kinds = value as Record<string, unknown>;
  if (Object.keys(kinds).length !== NOTIFICATION_KINDS.length) return null;
  let out = {} as Record<NotificationKind, boolean>;
  for (let kind of NOTIFICATION_KINDS) {
    if (typeof kinds[kind] !== "boolean") return null;
    out[kind] = kinds[kind] as boolean;
  }
  return out;
}
