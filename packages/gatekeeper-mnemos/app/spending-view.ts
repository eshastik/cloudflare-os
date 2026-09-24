/** Слова и суммы для экрана расходов: без идентификаторов и технических кодов. */

export const PERIOD_LABELS = { today: "Сегодня", "7d": "7 дней", "30d": "30 дней", all: "Всё время" } as const;
export const SPENDING_PERIODS = ["today", "7d", "30d", "all"] as const;

const KIND_LABELS: Record<string, string> = {
  chat: "Беседы",
  code_agent: "Агент кода",
  ingest: "Приём документов",
  service: "Служебное: названия, перевод, выбор режима, поиск, голос",
};

const OPERATION_LABELS: Record<string, string> = {
  "chat.reply": "Ответы агента беседы",
  "chat.compaction": "Сжатие длинной беседы",
  "chat.title": "Названия бесед",
  "app.title": "Названия приложений",
  "document.title": "Названия документов",
  "binding.name": "Имена подключений",
  "reasoning.translate": "Перевод размышлений",
  "router": "Выбор «код или беседа»",
  "voice.transcribe": "Распознавание речи",
  "app.model": "Модель внутри приложений",
  "code_agent.model": "Агент кода",
  "ingest.classify": "Определение роли документов",
  "ingest.embed": "Векторизация документов",
  "ingest.describe": "Описания документов",
  "ingest.describe_code": "Описания кода",
  "ingest.centroid": "Пересчёт профилей проектов",
  "search.embed": "Поиск по памяти",
  "embed": "Векторизация",
};

export const kindLabel = (key: string) => KIND_LABELS[key] ?? "Прочее";
export const operationLabel = (key: string) => OPERATION_LABELS[key] ?? "Прочие операции";

/** Имя строки разбивки для человека: пустой ключ и пустое имя — словами, без идентификатора. */
export function groupName(section: "projects" | "people" | "agents" | "models", key: string, name: string): string {
  if (name) return name;
  if (!key) return { projects: "Без проекта", people: "Служба Mnemos (без человека)", agents: "Без агента", models: "Модель не названа" }[section];
  return { projects: "Проект, который вам недоступен", people: "Сотрудник без имени", agents: "Агент без имени", models: key }[section];
}

/** Микродоллары в доллары для показа: крупные суммы — до центов, мелкие — с тремя значащими цифрами. */
export function formatUSD(micros: string): string {
  if (!/^\d{1,19}$/.test(micros)) return "—";
  const amount = BigInt(micros);
  if (amount === 0n) return "0 $";
  if (amount >= 10_000n) {
    const cents = (amount + 5_000n) / 10_000n;
    return `${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, "0")} $`;
  }
  // Меньше цента: показываются микродоллары без округления до нуля.
  return `${(Number(amount) / 1_000_000).toPrecision(3).replace(/0+$/, "").replace(/\.$/, "")} $`;
}

/** Рубли по курсу установки; без курса — пусто. */
export function formatRUB(micros: string, rate?: number): string {
  if (!rate || !(rate > 0) || !/^\d{1,19}$/.test(micros)) return "";
  const rub = Number(micros) / 1_000_000 * rate;
  return `≈ ${rub >= 1 ? rub.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : rub.toLocaleString("ru-RU", { maximumSignificantDigits: 3 })} ₽`;
}
