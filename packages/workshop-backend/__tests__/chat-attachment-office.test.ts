import { describe, expect, it } from "vitest";
import { extractOfficeText, officeDocumentKind, truncateUtf8 } from "../src/chat-attachment-office";
import { prepareChatAttachmentUpload } from "../src/chat-attachment-validation";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  let stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Минимальный zip: локальные заголовки, центральный каталог, конец каталога. CRC не проверяется
// разбором, поэтому пишется нулём.
async function zip(files: Record<string, string | Uint8Array>, deflate = true): Promise<Uint8Array> {
  let encoder = new TextEncoder();
  let locals: Uint8Array[] = [];
  let central: Uint8Array[] = [];
  let offset = 0;
  for (let [name, content] of Object.entries(files)) {
    let raw = typeof content === "string" ? encoder.encode(content) : content;
    let data = deflate ? await deflateRaw(raw) : raw;
    let nameBytes = encoder.encode(name);
    let local = new Uint8Array(30 + nameBytes.length + data.length);
    let lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    let entry = new Uint8Array(46 + nameBytes.length);
    let cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    locals.push(local);
    central.push(entry);
    offset += local.length;
  }
  let centralSize = central.reduce((sum, part) => sum + part.length, 0);
  let end = new Uint8Array(22);
  let ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  let result = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (let part of [...locals, ...central, end]) { result.set(part, at); at += part.length; }
  return result;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Отчёт за квартал</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Выручка </w:t></w:r><w:r><w:t>&lt;100&gt; &amp; рост</w:t></w:r><w:r><w:tab/><w:t>итог</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Статья</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Сумма</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Аренда</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>50&#160;000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:delText>удалено</w:delText><w:t>Конец</w:t></w:r></w:p>
</w:body></w:document>`;

function slide(text: string[]): string {
  return `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>${
    text.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

async function docx() { return zip({"[Content_Types].xml": "<Types/>", "word/document.xml": DOCUMENT_XML}); }

async function pptx() {
  return zip({
    "ppt/presentation.xml": "<p:presentation/>",
    "ppt/slides/slide10.xml": slide(["Итоги"]),
    "ppt/slides/slide2.xml": slide(["План", "Шаг 1"]),
  });
}

async function xlsx() {
  return zip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Продажи" sheetId="1" r:id="rId1"/><sheet name="Итог &amp; план" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Товар</t></si><si><r><t>Цена</t></r><r><t xml:space="preserve"> ₽</t></r></si><si><t>Чай</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12.5</v></c></row>
    </sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Всего</t></is></c><c r="B1"><f>SUM(A1)</f><v>42</v></c></row></sheetData></worksheet>`,
  });
}

describe("extractOfficeText", () => {
  it("docx: абзацы, табуляция, сущности, таблица по ячейкам", async () => {
    let text = await extractOfficeText(await docx(), "docx");
    expect(text).toBe(
      "Отчёт за квартал\nВыручка <100> & рост\tитог\nСтатья\tСумма\nАренда\t50 000\nКонец");
  });

  it("pptx: слайды по номеру, заголовок «Слайд N»", async () => {
    let text = await extractOfficeText(await pptx(), "pptx");
    expect(text).toBe("Слайд 2\nПлан\nШаг 1\n\nСлайд 10\nИтоги");
  });

  it("xlsx: два листа, общие строки, числа, inlineStr, пропуск столбца", async () => {
    let text = await extractOfficeText(await xlsx(), "xlsx");
    expect(text).toBe("Лист: Продажи\nТовар\tЦена ₽\nЧай\t\t12.5\n\nЛист: Итог & план\nВсего\t42");
  });

  it("stored-записи читаются так же, как deflate", async () => {
    let stored = await zip({"word/document.xml": DOCUMENT_XML}, false);
    expect(await extractOfficeText(stored, "docx")).toContain("Аренда\t50 000");
  });

  it("zip-бомба — отказ, а не распаковка в память", async () => {
    let bomb = await zip({"word/document.xml": new Uint8Array(25 * 1024 * 1024)});
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    await expect(extractOfficeText(bomb, "docx")).rejects.toThrow("слишком велик");
  });

  it("повреждённый архив — понятный отказ", async () => {
    let good = await docx();
    await expect(extractOfficeText(good.slice(0, good.length - 30), "docx")).rejects.toThrow("повреждён");
    let broken = good.slice();
    broken.fill(0xff, 40, 80); // портит сжатые данные первой записи
    await expect(extractOfficeText(broken, "docx")).rejects.toThrow("повреждён");
    await expect(extractOfficeText(await zip({"other.xml": "<x/>"}), "docx")).rejects.toThrow("повреждён");
  });
});

describe("prepareChatAttachmentUpload", () => {
  it("docx превращается в текстовое вложение с исходным именем", async () => {
    let result = await prepareChatAttachmentUpload(
        {mimeType: DOCX_MIME, content: await docx(), name: "Отчёт.docx"}, "anthropic");
    expect(result.mimeType).toBe("text/plain");
    expect(result.name).toBe("Отчёт.docx");
    let text = new TextDecoder().decode(result.content);
    expect(text).toMatch(/^\[Текст, извлечённый из документа «Отчёт\.docx»/);
    expect(text).toContain("Статья\tСумма");
  });

  it("octet-stream опознаётся по расширению; xlsx и pptx принимаются моделями без документов", async () => {
    let result = await prepareChatAttachmentUpload(
        {mimeType: "application/octet-stream", content: await xlsx(), name: "Продажи.xlsx"}, "ollama");
    expect(new TextDecoder().decode(result.content)).toContain("Лист: Продажи");
    let slides = await prepareChatAttachmentUpload({mimeType: PPTX_MIME, content: await pptx(), name: "План.pptx"});
    expect(new TextDecoder().decode(slides.content)).toContain("Слайд 10");
  });

  it("не zip под видом docx — отказ", async () => {
    await expect(prepareChatAttachmentUpload(
        {mimeType: DOCX_MIME, content: new TextEncoder().encode("hello"), name: "a.docx"}))
      .rejects.toThrow("Содержимое файла не совпадает с его типом.");
  });

  it("doc, xls, ppt и неизвестное — русский отказ с советом", async () => {
    let message = "Этот формат не поддерживается: сохраните документ как DOCX, XLSX, PPTX или PDF";
    for (let [mimeType, name] of [
      ["application/msword", "old.doc"],
      ["application/vnd.ms-excel", "old.xls"],
      ["application/octet-stream", "old.ppt"],
      ["application/zip", "archive.zip"],
    ]) {
      await expect(prepareChatAttachmentUpload(
          {mimeType, content: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), name}, "anthropic")).rejects.toThrow(message);
    }
  });

  it("CSV с типом Excel из Windows принимается как текст", async () => {
    let result = await prepareChatAttachmentUpload(
        {mimeType: "application/vnd.ms-excel", content: new TextEncoder().encode("a,b"), name: "data.csv"});
    expect(result.mimeType).toBe("text/csv");
  });

  it("документ больше 15 МиБ — отказ", async () => {
    let big = new Uint8Array(15 * 1024 * 1024 + 1);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    await expect(prepareChatAttachmentUpload({mimeType: DOCX_MIME, content: big, name: "big.docx"}))
      .rejects.toThrow("Документ больше 15 МиБ.");
  });
});

describe("helpers", () => {
  it("officeDocumentKind: MIME важнее расширения, octet-stream — по расширению", () => {
    expect(officeDocumentKind(XLSX_MIME, "x.bin")).toBe("xlsx");
    expect(officeDocumentKind("application/octet-stream", "Отчёт.DOCX")).toBe("docx");
    expect(officeDocumentKind("text/plain", "x.docx")).toBeUndefined();
  });

  it("truncateUtf8 обрезает по байтам с пометкой и не рвёт символ", () => {
    let text = "я".repeat(1000);
    let cut = truncateUtf8(text, 500);
    expect(new TextEncoder().encode(cut).byteLength).toBeLessThanOrEqual(500);
    expect(cut.endsWith("(текст обрезан)")).toBe(true);
    expect(cut).not.toContain("�");
    expect(truncateUtf8("коротко", 500)).toBe("коротко");
  });
});
