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
