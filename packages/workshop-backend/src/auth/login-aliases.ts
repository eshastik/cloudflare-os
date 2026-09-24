// Привязка почты к уже существующей учётной записи оболочки.
//
// Вход через гейткипер находит пользователя по почте: объект пользователя берётся как
// idFromName(почта). Учётная запись, заведённая раньше паролем, называется по имени
// (например, «admin»), и почтой её не найти. Без привязки владелец после перехода на вход
// через Mnemos получил бы новую пустую учётную запись, а беседы, документы и подключения
// остались бы в старой.
//
// Привязку задаёт установка переменной LOGIN_ALIASES: JSON-объект {"почта": "имя"}.
// Отменить её — убрать переменную: данные обеих учётных записей не трогаются.
// Имена паролей (буквы, цифры, «_») и почты (всегда с «@») не пересекаются, поэтому
// привязка не может увести почту в чужую почтовую учётную запись.

const USERNAME = /^[a-z][a-z0-9_]*$/;

export function parseLoginAliases(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("LOGIN_ALIASES должен быть JSON-объектом {\"почта\": \"имя\"}");
  }
  for (const [email, name] of Object.entries(parsed as Record<string, unknown>)) {
    const key = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key) || typeof name !== "string" || !USERNAME.test(name)) {
      throw new TypeError(`LOGIN_ALIASES: неверная пара ${JSON.stringify(email)}`);
    }
    out.set(key, name);
  }
  return out;
}

export interface ShellLoginTarget {
  /** Имя объекта пользователя (idFromName) и первая часть токена сессии. */
  name: string;
  /** Привязка к существующей учётной записи: новую заводить нельзя. */
  aliased: boolean;
}

export function shellLoginTarget(env: { LOGIN_ALIASES?: string }, email: string): ShellLoginTarget {
  const name = parseLoginAliases(env.LOGIN_ALIASES).get(email.trim().toLowerCase());
  return name ? { name, aliased: true } : { name: email, aliased: false };
}
