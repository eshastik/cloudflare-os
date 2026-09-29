// Приём документов Office (docx, xlsx, pptx) во вложения беседы: из архива извлекается текст, и
// вложение дальше живёт как текстовое. Модели не умеют читать эти форматы напрямую, а текст
// принимают все. Разбор zip свой и минимальный, чтобы не тянуть зависимость в Worker.

export type OfficeDocumentKind = "docx" | "xlsx" | "pptx";

export const MAX_OFFICE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_INFLATED_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_INFLATED_TOTAL_BYTES = 20 * 1024 * 1024;

export const UNSUPPORTED_ATTACHMENT_MESSAGE =
  "Этот формат не поддерживается: сохраните документ как DOCX, XLSX, PPTX или PDF";
const DAMAGED_DOCUMENT_MESSAGE = "Документ повреждён или не является файлом Office: текст извлечь не удалось.";

export class OfficeDocumentError extends Error {}

const OFFICE_EXTENSIONS: Record<string, OfficeDocumentKind> = {
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

// Старые двоичные форматы Office и соседние: разобрать их нечем, человеку нужен понятный совет.
const LEGACY_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);
const LEGACY_EXTENSIONS = new Set(["doc", "xls", "ppt", "rtf", "odt", "ods", "odp", "docm", "xlsm", "pptm"]);

function extensionOf(name: string | undefined): string {
  let match = /\.([A-Za-z0-9]+)$/.exec(name ?? "");
  return match ? match[1].toLowerCase() : "";
}

/** Какой документ Office прислан: по MIME, а при безымянном типе — по расширению имени. */
export function officeDocumentKind(mimeType: string, name: string | undefined): OfficeDocumentKind | undefined {
  const prefix = "application/vnd.openxmlformats-officedocument.";
  if (mimeType.startsWith(prefix)) {
    let rest = mimeType.slice(prefix.length);
    if (rest.startsWith("wordprocessingml.")) return "docx";
    if (rest.startsWith("spreadsheetml.")) return "xlsx";
    if (rest.startsWith("presentationml.")) return "pptx";
    return undefined;
  }
  if (mimeType === "application/octet-stream" || mimeType === "application/zip" ||
      mimeType === "application/x-zip-compressed") {
    return OFFICE_EXTENSIONS[extensionOf(name)];
  }
  return undefined;
}

/** Старый или иной формат документа, для которого нужен отказ с советом пересохранить. */
export function isLegacyDocument(mimeType: string, name: string | undefined): boolean {
  return LEGACY_MIME_TYPES.has(mimeType) || LEGACY_EXTENSIONS.has(extensionOf(name));
}

// ---------------------------------------------------------------------------------------------
// zip

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

class ZipReader {
  readonly entries = new Map<string, ZipEntry>();
  #inflatedTotal = 0;
  readonly #bytes: Uint8Array;
  readonly #view: DataView;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 22 || this.#u32(0) !== 0x04034b50) throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);

    let eocd = -1;
    for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 0xffff); i--) {
      if (this.#u32(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);

    let count = this.#u16(eocd + 10);
    let offset = this.#u32(eocd + 16);
    if (count === 0xffff || offset === 0xffffffff) throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
    if (count > MAX_ZIP_ENTRIES) throw new OfficeDocumentError("В документе слишком много частей, разбирать его небезопасно.");

    let decoder = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (offset + 46 > bytes.byteLength || this.#u32(offset) !== 0x02014b50) {
        throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
      }
      let flags = this.#u16(offset + 8);
      let nameLength = this.#u16(offset + 28);
      let end = offset + 46 + nameLength + this.#u16(offset + 30) + this.#u16(offset + 32);
      if (end > bytes.byteLength) throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
      if (flags & 1) throw new OfficeDocumentError("Документ зашифрован паролем: снимите пароль и загрузите снова.");
      let name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      this.entries.set(name, {
        name,
        method: this.#u16(offset + 10),
        compressedSize: this.#u32(offset + 20),
        localHeaderOffset: this.#u32(offset + 42),
      });
      offset = end;
    }
  }

  #u16(at: number): number { return this.#view.getUint16(at, true); }
  #u32(at: number): number { return this.#view.getUint32(at, true); }

  async read(name: string): Promise<Uint8Array | undefined> {
    let entry = this.entries.get(name);
    if (!entry) return undefined;
    let at = entry.localHeaderOffset;
    if (at + 30 > this.#bytes.byteLength || this.#u32(at) !== 0x04034b50) {
      throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
    }
    let start = at + 30 + this.#u16(at + 26) + this.#u16(at + 28);
    let end = start + entry.compressedSize;
    if (end > this.#bytes.byteLength) throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
    let data = this.#bytes.subarray(start, end);
    let limit = Math.min(MAX_INFLATED_ENTRY_BYTES, MAX_INFLATED_TOTAL_BYTES - this.#inflatedTotal);

    let result: Uint8Array;
    if (entry.method === 0) {
      if (data.byteLength > limit) throw bombError();
      result = data;
    } else if (entry.method === 8) {
      result = await inflateRaw(data, limit);
    } else {
      throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
    }
    this.#inflatedTotal += result.byteLength;
    return result;
  }

  async readText(name: string): Promise<string | undefined> {
    let data = await this.read(name);
    return data && new TextDecoder().decode(data);
  }
}

function bombError(): OfficeDocumentError {
  return new OfficeDocumentError("Документ после распаковки слишком велик, разбирать его небезопасно.");
}

// Распаковка потоком со счётчиком: заявленному в архиве размеру не верим, иначе zip-бомба
// развернётся в память целиком раньше проверки.
async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  let stream = new DecompressionStream("deflate-raw");
  let writer = stream.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  let reader = stream.readable.getReader();
  let chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let {done, value} = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => {});
        throw bombError();
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof OfficeDocumentError) throw err;
    throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
  }
  let result = new Uint8Array(total);
  let at = 0;
  for (let chunk of chunks) {
    result.set(chunk, at);
    at += chunk.byteLength;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// XML: хватает плоского обхода тегов, дерево не строится.

type XmlEvent =
  | {type: "open"; name: string; attrs: string; selfClosing: boolean}
  | {type: "close"; name: string}
  | {type: "text"; text: string};

const XML_TOKEN = /<(\/?)([A-Za-z_][\w.\-]*(?::[\w.\-]+)?)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<![^>]*>/g;

function localName(name: string): string {
  let colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

function* xmlEvents(xml: string): Generator<XmlEvent> {
  let last = 0;
  XML_TOKEN.lastIndex = 0;
  for (let match of xml.matchAll(XML_TOKEN)) {
    if (match.index > last) yield {type: "text", text: decodeXmlEntities(xml.slice(last, match.index))};
    last = match.index + match[0].length;
    if (match[5] !== undefined) {
      yield {type: "text", text: match[5]};
    } else if (match[2] !== undefined) {
      let name = localName(match[2]);
      if (match[1]) {
        yield {type: "close", name};
      } else {
        yield {type: "open", name, attrs: match[3], selfClosing: match[4] === "/"};
        if (match[4] === "/") yield {type: "close", name};
      }
    }
  }
  if (last < xml.length) yield {type: "text", text: decodeXmlEntities(xml.slice(last))};
}

const NAMED_ENTITIES: Record<string, string> = {lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'"};

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      let code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function attribute(attrs: string, name: string): string | undefined {
  let pattern = new RegExp(`(?:^|\\s)(?:[\\w.\\-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`);
  let match = pattern.exec(attrs);
  if (!match) return undefined;
  return decodeXmlEntities(match[2] ?? match[3]);
}

// ---------------------------------------------------------------------------------------------
// docx

type CellContext = {rows: string[]; cells: string[]; cell: string};

function docxText(xml: string): string {
  let out = "";
  let tables: CellContext[] = [];
  let textDepth = 0;
  let runDepth = 0;
  let fallbackDepth = 0;

  let append = (text: string) => {
    let table = tables.at(-1);
    if (table) table.cell += text;
    else out += text;
  };

  for (let event of xmlEvents(xml)) {
    if (event.type === "text") {
      if (textDepth > 0 && fallbackDepth === 0) append(event.text);
      continue;
    }
    let name = event.name;
    if (event.type === "open") {
      // Текстовые рамки записаны дважды: в mc:Choice и в запасном mc:Fallback. Берём одну копию.
      if (name === "Fallback") fallbackDepth++;
      if (fallbackDepth > 0) continue;
      if (name === "t") textDepth++;
      else if (name === "r") runDepth++;
      else if (name === "tbl") tables.push({rows: [], cells: [], cell: ""});
      else if (runDepth > 0 && name === "tab") append("\t");
      else if (runDepth > 0 && (name === "br" || name === "cr")) append("\n");
      continue;
    }
    if (name === "Fallback") { fallbackDepth = Math.max(0, fallbackDepth - 1); continue; }
    if (fallbackDepth > 0) continue;
    if (name === "t") textDepth = Math.max(0, textDepth - 1);
    else if (name === "r") runDepth = Math.max(0, runDepth - 1);
    else if (name === "p") append(tables.length > 0 ? " " : "\n");
    else if (name === "tc") {
      let table = tables.at(-1);
      if (table) { table.cells.push(table.cell.replace(/[ \t\r\n]+/g, " ").trim()); table.cell = ""; }
    } else if (name === "tr") {
      let table = tables.at(-1);
      if (table) { table.rows.push(table.cells.join("\t")); table.cells = []; }
    } else if (name === "tbl") {
      let table = tables.pop();
      if (table) {
        let rendered = table.rows.join("\n");
        if (tables.length > 0) append(rendered.replace(/\n/g, " "));
        else out += rendered + "\n";
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// pptx

function slideText(xml: string): string {
  let out = "";
  let textDepth = 0;
  for (let event of xmlEvents(xml)) {
    if (event.type === "text") {
      if (textDepth > 0) out += event.text;
    } else if (event.type === "open") {
      if (event.name === "t") textDepth++;
      else if (event.name === "br") out += "\n";
      else if (event.name === "tab") out += "\t";
    } else if (event.name === "t") {
      textDepth = Math.max(0, textDepth - 1);
    } else if (event.name === "p") {
      out += "\n";
    }
  }
  return out;
}

function numberedParts(zip: ZipReader, pattern: RegExp): {n: number; name: string}[] {
  let result: {n: number; name: string}[] = [];
  for (let name of zip.entries.keys()) {
    let match = pattern.exec(name);
    if (match) result.push({n: Number(match[1]), name});
  }
  return result.sort((a, b) => a.n - b.n);
}

// ---------------------------------------------------------------------------------------------
// xlsx

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  let result: string[] = [];
  let current: string | null = null;
  let textDepth = 0;
  let phoneticDepth = 0;
  for (let event of xmlEvents(xml)) {
    if (event.type === "text") {
      if (current !== null && textDepth > 0 && phoneticDepth === 0) current += event.text;
    } else if (event.type === "open") {
      if (event.name === "si") current = "";
      else if (event.name === "t") textDepth++;
      else if (event.name === "rPh") phoneticDepth++;
    } else if (event.name === "si") {
      result.push(current ?? "");
      current = null;
    } else if (event.name === "t") {
      textDepth = Math.max(0, textDepth - 1);
    } else if (event.name === "rPh") {
      phoneticDepth = Math.max(0, phoneticDepth - 1);
    }
  }
  return result;
}

function columnIndex(ref: string | undefined): number | undefined {
  let match = /^([A-Z]+)/i.exec(ref ?? "");
  if (!match) return undefined;
  let index = 0;
  for (let char of match[1].toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function sheetText(xml: string, strings: string[]): string {
  let rows: string[] = [];
  let row: string[] | null = null;
  let cellType = "";
  let cellColumn: number | undefined;
  let value: string | null = null;
  let inValue = false;
  let inInline = 0;
  let inText = 0;

  for (let event of xmlEvents(xml)) {
    if (event.type === "text") {
      if (inValue || (inInline > 0 && inText > 0)) value = (value ?? "") + event.text;
      continue;
    }
    if (event.type === "open") {
      switch (event.name) {
        case "row": row = []; break;
        case "c":
          cellType = attribute(event.attrs, "t") ?? "";
          cellColumn = columnIndex(attribute(event.attrs, "r"));
          value = null;
          break;
        case "v": inValue = true; break;
        case "is": inInline++; break;
        case "t": inText++; break;
      }
      continue;
    }
    switch (event.name) {
      case "v": inValue = false; break;
      case "is": inInline = Math.max(0, inInline - 1); break;
      case "t": inText = Math.max(0, inText - 1); break;
      case "c": {
        if (!row) break;
        let text = value ?? "";
        if (cellType === "s") text = strings[Number(text)] ?? "";
        else if (cellType === "b") text = text === "1" ? "TRUE" : text === "0" ? "FALSE" : text;
        let column = cellColumn ?? row.length;
        while (row.length < column) row.push("");
        row[column] = text.replace(/[\t\r\n]+/g, " ");
        break;
      }
      case "row":
        if (row && row.some((cell) => cell !== "")) {
          while (row.length > 0 && row.at(-1) === "") row.pop();
          rows.push(Array.from(row, (cell) => cell ?? "").join("\t"));
        }
        row = null;
        break;
    }
  }
  return rows.join("\n");
}

function resolveWorkbookTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  let parts = ["xl"];
  for (let part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

async function workbookSheets(zip: ZipReader): Promise<{name: string; path: string}[]> {
  let workbook = await zip.readText("xl/workbook.xml");
  if (workbook === undefined) throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
  let rels = new Map<string, string>();
  let relsXml = await zip.readText("xl/_rels/workbook.xml.rels");
  for (let event of xmlEvents(relsXml ?? "")) {
    if (event.type === "open" && event.name === "Relationship") {
      let id = attribute(event.attrs, "Id");
      let target = attribute(event.attrs, "Target");
      if (id && target) rels.set(id, resolveWorkbookTarget(target));
    }
  }
  let sheets: {name: string; path: string}[] = [];
  let position = 0;
  for (let event of xmlEvents(workbook)) {
    if (event.type !== "open" || event.name !== "sheet") continue;
    position++;
    let relId = /\br:id\s*=\s*"([^"]*)"/.exec(event.attrs)?.[1] ?? attribute(event.attrs, "id");
    let path = (relId && rels.get(relId)) ?? `xl/worksheets/sheet${position}.xml`;
    sheets.push({name: attribute(event.attrs, "name") ?? `Лист ${position}`, path});
  }
  return sheets;
}

// ---------------------------------------------------------------------------------------------

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[  ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Извлечь текст документа Office. Повреждённый архив и zip-бомба дают OfficeDocumentError. */
export async function extractOfficeText(bytes: Uint8Array, kind: OfficeDocumentKind): Promise<string> {
  let zip = new ZipReader(bytes);
  switch (kind) {
    case "docx": {
      let xml = await zip.readText("word/document.xml");
      if (xml === undefined) throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
      return tidy(docxText(xml));
    }
    case "pptx": {
      let slides = numberedParts(zip, /^ppt\/slides\/slide(\d+)\.xml$/);
      if (slides.length === 0 && !zip.entries.has("ppt/presentation.xml")) {
        throw new OfficeDocumentError(DAMAGED_DOCUMENT_MESSAGE);
      }
      let parts: string[] = [];
      for (let slide of slides) {
        let text = tidy(slideText((await zip.readText(slide.name)) ?? ""));
        parts.push(`Слайд ${slide.n}` + (text ? `\n${text}` : ""));
      }
      return parts.join("\n\n");
    }
    case "xlsx": {
      let strings = sharedStrings(await zip.readText("xl/sharedStrings.xml"));
      let parts: string[] = [];
      for (let sheet of await workbookSheets(zip)) {
        let xml = await zip.readText(sheet.path);
        let text = xml === undefined ? "" : sheetText(xml, strings);
        parts.push(`Лист: ${sheet.name}` + (text ? `\n${text}` : ""));
      }
      return parts.join("\n\n");
    }
  }
}

/** Обрезать текст до предела в байтах UTF-8, оставив пометку об обрезке. */
export function truncateUtf8(text: string, maxBytes: number): string {
  let encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return text;
  let marker = "\n\n(текст обрезан)";
  let room = maxBytes - new TextEncoder().encode(marker).byteLength;
  let head = new TextDecoder().decode(encoded.subarray(0, Math.max(0, room))).replace(/�+$/, "");
  return head + marker;
}

/** Текст, который уходит агенту вместо документа: пометка об источнике и извлечённый текст. */
export function officeAttachmentText(name: string | undefined, text: string, maxBytes: number): string {
  let label = name ? `«${name}»` : "без имени";
  let header = `[Текст, извлечённый из документа ${label}. Форматирование, картинки и диаграммы не переданы.]\n\n`;
  return truncateUtf8(header + (text || "(в документе нет текста)"), maxBytes);
}
