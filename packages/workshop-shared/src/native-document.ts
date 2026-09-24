/** Native structured document formats understood by the bundled output applications. */
export type NativeDocumentFormat = "cloudflareos.document" | "cloudflareos.spreadsheet" | "cloudflareos.presentation";

/** Data snapshot; this envelope never carries application code or resource authority. */
export interface NativeDocumentSnapshot {
  /** Output application that can interpret the document data. */
  format: NativeDocumentFormat;
  /** Version of the data envelope, independent of the local editing revision. */
  formatVersion: 1;
  /** Structured data validated by the destination application's restore operation. */
  document: Record<string, unknown>;
}

/** Data restoration contract implemented by the bundled native editors. */
export interface NativeDocumentEditor {
  /** Возвращает текущую редакцию для защиты от перезаписи параллельной правки. */
  getDocument(): Promise<{revision: number}>;
  /** Replace validated document data only if the editing revision still matches. */
  restoreDocumentSnapshot(snapshot: NativeDocumentSnapshot, expectedRevision: number): Promise<unknown>;
}

/** Check a native data format at an RPC or browser boundary. */
export function isNativeDocumentFormat(value: unknown): value is NativeDocumentFormat {
  return value === "cloudflareos.document" || value === "cloudflareos.spreadsheet" || value === "cloudflareos.presentation";
}

/** Документ Mnemos, к которому привязан встроенный редактор. Привязка у каждого человека своя: сохранение идёт в его личный черновик. */
export type NativeMnemosBinding = {
  /** Подключение Mnemos; null — привязка из старой версии интерфейса, подключение выбирается первым подходящим. */
  accountId: number | null;
  /** Проект Mnemos. */
  scope: string;
  /** Документ в проекте. */
  resource: string;
  /** Ревизия редактора, совпавшая с последним сохранением. */
  savedRevision?: number;
  /** Версия документа в Mnemos (голова ветки владельца), от которой редактор правит. Сохранение
   *  проходит, только если сам документ с тех пор не менялся; иначе — явный конфликт, правка не теряется. */
  savedHead?: string;
};

/** Начатое создание документа в Mnemos. Квитанция позволяет повторить то же создание без дубликата. */
export type NativeMnemosCreation = {
  /** Метка захвата: создание ведёт одна вкладка. */
  claim: string;
  accountId: number;
  scope: string;
  name: string;
  /** Квитанция замороженной заявки на создание; есть — создание повторяется ей, а не заново. */
  receipt?: string;
  /** Время захвата, мс. */
  at: number;
};

/** Что знает рабочее место о документе Mnemos этого редактора для текущего человека. */
export type NativeMnemosState = {
  binding: NativeMnemosBinding | null;
  creation: NativeMnemosCreation | null;
  /** Первый проект беседы, в которой создан редактор; null — у беседы нет проекта или она чужая. */
  project: { accountId: number; projectId: string; title: string } | null;
};

const DEFAULT_TITLES: Record<NativeDocumentFormat, string[]> = {
  "cloudflareos.document": ["Новый документ", "Untitled document"],
  "cloudflareos.spreadsheet": ["Новая таблица", "Untitled spreadsheet"],
  "cloudflareos.presentation": ["Новая презентация", "Untitled presentation"],
};
/** Текст заглавного слайда стартовой презентации; заголовком он не считается. */
const PRESENTATION_TEMPLATE_TEXTS = new Set(["Название презентации", "Подзаголовок: о чём и для кого"]);

/** Название встроенного документа по умолчанию («Новый документ» и т. п.). */
export function defaultNativeTitle(format: NativeDocumentFormat): string {
  return DEFAULT_TITLES[format][0];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
function htmlText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    });
}
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** Текст встроенного документа для названия: заданное название, заголовки и первые строки. */
export type NativeTitleSource = {
  /** Название, заданное человеком или агентом; null — стоит название по умолчанию. */
  title: string | null;
  /** Заголовки по порядку. */
  headings: string[];
  /** Непустые строки текста по порядку, не больше 200. */
  lines: string[];
  /** В документе есть содержимое, которое стоит сохранять. */
  hasContent: boolean;
};

/** Разбирает снимок встроенного документа. Неизвестная форма даёт пустой источник, а не ошибку. */
export function nativeTitleSource(format: NativeDocumentFormat, document: unknown): NativeTitleSource {
  const doc = (document && typeof document === "object" ? document : {}) as Record<string, unknown>;
  const rawTitle = typeof doc.title === "string" ? oneLine(doc.title) : "";
  const title = rawTitle && !DEFAULT_TITLES[format].includes(rawTitle) ? rawTitle : null;
  const headings: string[] = [], lines: string[] = [];
  const push = (text: string, heading = false) => {
    for (const line of text.split("\n").map(oneLine).filter(Boolean)) {
      if (lines.length < 200) lines.push(line);
      if (heading && headings.length < 20) headings.push(line);
    }
  };
  let hasContent = false;
  if (format === "cloudflareos.document") {
    for (const block of Array.isArray(doc.blocks) ? doc.blocks : []) {
      const html = typeof (block as { html?: unknown })?.html === "string" ? (block as { html: string }).html : "";
      push(htmlText(html), /^\s*<h[1-3]\b/i.test(html));
    }
    hasContent = lines.length > 0;
  } else if (format === "cloudflareos.spreadsheet") {
    const order = Array.isArray(doc.sheetOrder) ? doc.sheetOrder.map(String) : [];
    const cells = (doc.cells && typeof doc.cells === "object" ? doc.cells : {}) as Record<string, Record<string, { value?: unknown }>>;
    const position = (address: string) => { const m = /^([A-Z]+)([0-9]+)$/.exec(address); if (!m) return [Infinity, Infinity]; let col = 0; for (const c of m[1]) col = col * 26 + c.charCodeAt(0) - 64; return [Number(m[2]), col] };
    for (const id of order) {
      const sheet = cells[id] && typeof cells[id] === "object" ? cells[id] : {};
      const entries = Object.entries(sheet).filter(([, cell]) => typeof cell?.value === "string" && cell.value.trim())
        .sort(([a], [b]) => { const [ra, ca] = position(a), [rb, cb] = position(b); return ra - rb || ca - cb; });
      for (const [, cell] of entries) {
        hasContent = true;
        const value = cell.value as string;
        if (!value.startsWith("=") && /\p{L}/u.test(value)) push(value);
      }
    }
  } else {
    const slides = Array.isArray(doc.slides) ? doc.slides : [];
    for (const slide of slides) {
      for (const block of Array.isArray((slide as { blocks?: unknown })?.blocks) ? (slide as { blocks: unknown[] }).blocks : []) {
        const b = block as { type?: unknown; props?: Record<string, unknown> };
        const text = typeof b?.props?.text === "string" ? oneLine(b.props.text) : "";
        if (!text || PRESENTATION_TEMPLATE_TEXTS.has(text)) continue;
        push(text, b.type === "title");
      }
    }
    // Стартовая презентация уже содержит слайды-образцы: содержимым считается любая правка после создания.
    hasContent = typeof doc.revision === "number" && doc.revision > 0 && lines.length > 0;
  }
  return { title, headings, lines, hasContent: hasContent || title !== null };
}

/** Допустимое имя документа Mnemos: одна строка без косых черт, не длиннее 120 символов. */
export function cleanNativeTitle(value: string): string {
  let text = oneLine(value.replace(/[\u0000-\u001f\u007f]/g, " ")).replace(/^[#*>\-–—•\s]+/, "").replace(/[*_`]+/g, "")
    .replace(/^["«„'“]+|["»“'”]+$/g, "").replace(/[/\\]/g, "-").replace(/[\s.:;,]+$/, "").trim();
  if (text.length > 120) {
    const cut = text.slice(0, 120), space = cut.lastIndexOf(" ");
    text = `${(space > 60 ? cut.slice(0, space) : cut).replace(/[\s.:;,]+$/, "")}…`;
  }
  return text;
}

/** Название без модели: первый заголовок, иначе короткая первая строка. null — нужна модель или текста нет. */
export function deriveNativeTitle(source: NativeTitleSource): string | null {
  if (source.title) return cleanNativeTitle(source.title) || null;
  const heading = source.headings.map(cleanNativeTitle).find(Boolean);
  if (heading) return heading;
  const first = source.lines[0] ? cleanNativeTitle(source.lines[0]) : "";
  if (first && !first.endsWith("…") && first.length <= 80 && /\p{L}/u.test(first)) return first;
  return null;
}

/** Идентификаторы каталога выходных форматов и снимков относятся к одному редактору. */
export function nativeFormatForOutput(value: unknown): NativeDocumentFormat | null {
  if (isNativeDocumentFormat(value)) return value;
  if (value === 'document') return 'cloudflareos.document';
  if (value === 'spreadsheet') return 'cloudflareos.spreadsheet';
  if (value === 'presentation') return 'cloudflareos.presentation';
  return null;
}
