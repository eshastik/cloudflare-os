import { describe, expect, it } from "vitest";
import type { AiChatMetadata, ChatDocumentRef } from "@gadgets/workshop-shared/api";
import {
  chatDocumentContentType, chatDocumentNote, chatDocumentRequestId, chatDocumentTarget, checkedChatDocument, checkedChatDocumentTicket, legacyProjectNote,
} from "../src/chat-documents";
import { prepareChatAttachmentUpload } from "../src/chat-attachment-validation";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CHECKSUM = "q".repeat(43) + "=";

describe("вид документа беседы", () => {
  it("узнаёт документы по MIME и по расширению при пустом или общем типе", () => {
    expect(chatDocumentContentType("application/pdf", "a.pdf")).toBe("application/pdf");
    expect(chatDocumentContentType(DOCX + "; charset=binary", "a.docx")).toBe(DOCX);
    expect(chatDocumentContentType("", "Продажи.XLSX")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(chatDocumentContentType("application/zip", "План.pptx")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(chatDocumentContentType("", "заметки.md")).toBe("text/markdown");
    expect(chatDocumentContentType("application/vnd.ms-excel", "выгрузка.csv")).toBe("text/csv");
    expect(chatDocumentContentType("text/json", "a.json")).toBe("application/json");
    expect(chatDocumentContentType("text/plain", "a.txt")).toBe("text/plain");
  });
  it("картинки, код и старые форматы — не документы этого пути", () => {
    expect(chatDocumentContentType("image/png", "a.png")).toBeUndefined();
    expect(chatDocumentContentType("text/x-python", "a.py")).toBeUndefined();
    expect(chatDocumentContentType("application/msword", "a.doc")).toBeUndefined();
    expect(chatDocumentContentType("application/zip", "архив.zip")).toBeUndefined();
  });
});

describe("описание документа для билета", () => {
  it("PDF больше 100 МиБ принимается; предел одного PUT — 5 ГиБ; пустой файл и неверная сумма отвергаются", () => {
    expect(checkedChatDocument({name: " Отчёт.docx ", mimeType: DOCX, size: 200 * 1024 * 1024, checksum: CHECKSUM}))
      .toEqual({name: "Отчёт.docx", contentType: DOCX, size: 200 * 1024 * 1024, checksum: CHECKSUM});
    expect(() => checkedChatDocument({name: "a.pdf", mimeType: "application/pdf", size: 5 * 1024 * 1024 * 1024 + 1, checksum: CHECKSUM})).toThrow(/5 ГиБ/);
    expect(() => checkedChatDocument({name: "a.pdf", mimeType: "application/pdf", size: 0, checksum: CHECKSUM})).toThrow(/пустой/);
    expect(() => checkedChatDocument({name: "a.pdf", mimeType: "application/pdf", size: 5, checksum: "abc"})).toThrow(/сумма/);
    expect(() => checkedChatDocument({name: "фото.png", mimeType: "image/png", size: 5, checksum: CHECKSUM})).toThrow(/нельзя прикрепить как документ/);
  });
});

describe("билет из подключения", () => {
  const ticket = {upload_id: "up-1", url: "https://storage.example/staging/up-1?sig=1", method: "PUT", checksum_value: CHECKSUM, content_length: 10};
  const file = {size: 10, checksum: CHECKSUM};
  it("отдаётся браузеру только с адресом хранилища установки", () => {
    expect(checkedChatDocumentTicket({storageOrigin: "https://storage.example", ticket}, file)).toBe("https://storage.example");
    for (let bad of [
      {storageOrigin: "https://storage.example", ticket: {...ticket, url: "https://evil.example/x"}},
      {storageOrigin: "http://storage.example", ticket: {...ticket, url: "http://storage.example/x"}},
      {storageOrigin: "https://storage.example", ticket: {...ticket, url: "https://user:pw@storage.example/x"}},
      {storageOrigin: "https://storage.example", ticket: {...ticket, method: "POST"}},
      {storageOrigin: "https://storage.example", ticket: {...ticket, content_length: 11}},
      {storageOrigin: "https://storage.example", ticket: {...ticket, checksum_value: "r".repeat(43) + "="}},
      {storageOrigin: "не адрес", ticket},
    ]) {
      expect(() => checkedChatDocumentTicket(bad, file)).toThrow(/неожиданный адрес/);
    }
  });
});

const meta = (project = true, creator = "user-1") => ({
  id: 5, started: "2026-09-29T10:00:00.000Z",
  projectContext: project ? {accountId: 3, projectId: "p-1", title: "Mnemos", projects: [{accountId: 3, projectId: "p-1", title: "Mnemos", pinnedBy: "user"}], creatorId: creator, creatorProfileId: "prof"} : undefined,
}) as unknown as AiChatMetadata;

describe("куда ложится документ", () => {
  it("проект беседы; без беседы — выбранный проект; иначе личное пространство", () => {
    expect(chatDocumentTarget(meta(), "user-1")).toEqual({accountId: 3, projectId: "p-1", title: "Mnemos"});
    expect(chatDocumentTarget(undefined, "user-1", {accountId: 4, projectId: "p-2"})).toEqual({accountId: 4, projectId: "p-2", title: ""});
    expect(chatDocumentTarget(undefined, "user-1")).toEqual({accountId: null, projectId: null, title: ""});
    // Чужая беседа с проектом: проект человека не его — личное пространство; подсказка при беседе не действует.
    expect(chatDocumentTarget(meta(true, "user-2"), "user-1", {accountId: 4, projectId: "p-2"})).toEqual({accountId: null, projectId: null, title: ""});
    expect(chatDocumentTarget(meta(false), "user-1")).toEqual({accountId: null, projectId: null, title: ""});
  });
  it("квитанция одна для того же файла в той же беседе и проекте, иначе разная", async () => {
    let chat = {creatorId: "user-1", chatId: 5, started: 1};
    let a = await chatDocumentRequestId(chat, "p-1", CHECKSUM);
    expect(a).toMatch(/^chat-[0-9a-f]{48}$/);
    expect(await chatDocumentRequestId(chat, "p-1", CHECKSUM)).toBe(a);
    expect(await chatDocumentRequestId(chat, "p-2", CHECKSUM)).not.toBe(a);
    expect(await chatDocumentRequestId({...chat, chatId: 6}, "p-1", CHECKSUM)).not.toBe(a);
    expect(await chatDocumentRequestId(undefined, "p-1", CHECKSUM)).not.toBe(await chatDocumentRequestId(undefined, "p-1", CHECKSUM));
  });
});

describe("что видит агент", () => {
  const doc: ChatDocumentRef = {accountId: 3, projectId: "p-personal", projectTitle: "Личное пространство", personal: true,
    resource: "node-9", name: "Отчёт.docx", contentType: DOCX, size: 2 * 1024 * 1024};
  it("сведения о файле и способ чтения, без текста файла", () => {
    let note = chatDocumentNote(doc);
    expect(note).toContain("«Отчёт.docx»");
    expect(note).toContain("личное пространство");
    expect(note).toContain('project="p-personal", node="node-9"');
    expect(note).toContain("MNEMOS.readChatFile(project, node, offset)");
    expect(note).toContain("preparing");
    expect(note).toContain("MNEMOS.moveFileToProject");
    expect(note).toContain("2.0 МБ");
    let inProject = chatDocumentNote({...doc, personal: false, projectTitle: "Стройка"});
    expect(inProject).toContain("проект «Стройка»");
    expect(inProject).not.toContain("moveFileToProject");
  });
  it("старые сообщения с копией в проекте читаются прежним текстом", () => {
    expect(legacyProjectNote({saved: true, accountId: 3, projectId: "p", projectTitle: "Mnemos", resource: "n", name: "Отчёт (2).docx"}))
      .toContain("сохранён в проект «Mnemos» личной версией под именем «Отчёт (2).docx»");
    expect(legacyProjectNote(undefined)).toBe("");
  });
});

describe("старый путь байтами закрыт для документов", () => {
  it("документ через uploadChatAttachment отвергается, картинка проходит", () => {
    for (let [mimeType, name] of [[DOCX, "Отчёт.docx"], ["application/pdf", "a.pdf"], ["text/plain", "a.txt"], ["", "a.md"], ["application/vnd.ms-excel", "a.csv"]]) {
      expect(() => prepareChatAttachmentUpload({mimeType, name, content: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])})).toThrow(/через Mnemos/);
    }
    expect(() => prepareChatAttachmentUpload({mimeType: "application/msword", name: "a.doc", content: new Uint8Array([1])})).toThrow(/DOCX, XLSX, PPTX или PDF/);
    let png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]);
    expect(prepareChatAttachmentUpload({mimeType: "image/png", name: "a.png", content: png}).mimeType).toBe("image/png");
    expect(prepareChatAttachmentUpload({mimeType: "text/x-python", name: "a.py", content: new Uint8Array([0x61])}).mimeType).toBe("text/x-python");
  });
});

describe("уведомление о переносе доходит до Telegram", () => {
  it("событие переноса и соседние события из миграции 0179 не ломают страницу очереди", async () => {
    let {validNotificationPage} = await import("@gadgets/workshop-shared/telegram-bot");
    let item = (sequence: number, object: Record<string, string>, kind = "task_result") =>
      ({sequence, kind, object, summary: `Событие ${sequence}`, created_at: "2026-09-29T10:00:00Z"});
    let page = validNotificationPage({next_after: 5, delivered: 0, more: false, items: [
      // Так Mnemos ставит уведомление о переносе: итог задачи, объект — новый узел в проекте назначения.
      item(1, {type: "document", id: "moved-1", project_id: "p-team", owner_id: "user-1"}),
      item(2, {type: "inbox_alert", id: "a1"}, "decision_needed"),
      item(3, {type: "inbox_alert", id: "a2", project_id: "p-intake"}, "decision_needed"),
      item(4, {type: "template_promotion", id: "t1"}, "decision_needed"),
      item(5, {type: "project", id: "p-team", project_id: "p-team"}, "shared_with_me"),
    ]});
    expect(page?.items.map(i => i.object.type)).toEqual(["document", "inbox_alert", "inbox_alert", "template_promotion", "project"]);
    expect(validNotificationPage({next_after: 1, delivered: 0, more: false, items: [item(1, {type: "project", id: "p1", project_id: "p2"}, "shared_with_me")]})).toBeNull();
    expect(validNotificationPage({next_after: 1, delivered: 0, more: false, items: [item(1, {type: "document", id: "n", project_id: "p"})]})).toBeNull();
  });
});

describe("без подключения Mnemos", () => {
  it("текст и PDF идут прежним путём с пределом 1 МиБ, Office — понятный отказ", () => {
    let md = prepareChatAttachmentUpload({mimeType: "", name: "заметки.md", content: new TextEncoder().encode("# Итоги")}, undefined, false);
    expect(md.mimeType).toBe("text/markdown");
    for (let [mimeType, name] of [["text/plain", "a.txt"], ["application/vnd.ms-excel", "a.csv"], ["text/json", "a.json"]]) {
      expect(prepareChatAttachmentUpload({mimeType, name, content: new Uint8Array([0x61])}, undefined, false).mimeType).toMatch(/^(text|application)\//);
    }
    let pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(prepareChatAttachmentUpload({mimeType: "application/pdf", name: "a.pdf", content: pdf}, "anthropic", false).mimeType).toBe("application/pdf");
    expect(() => prepareChatAttachmentUpload({mimeType: "text/plain", name: "big.txt", content: new Uint8Array(1024 * 1024 + 1)}, undefined, false)).toThrow(/1 МиБ/);
    expect(() => prepareChatAttachmentUpload({mimeType: DOCX, name: "Отчёт.docx", content: new Uint8Array([0x50, 0x4b, 3, 4])}, undefined, false)).toThrow(/подключите Mnemos/);
  });
});
