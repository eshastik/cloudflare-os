import { describe, it, expect } from "vitest";
import type { BlueprintOutput } from "@gadgets/workshop-shared/api";
import {
  MNEMOS_CLAIM_TTL_MS, MNEMOS_RECEIPT_TTL_MS, claimMnemosCreation, mnemosDocumentState, mnemosProjectForChat,
  recordMnemosReceipt, setMnemosBinding, validateMnemosBinding,
} from "../src/native-mnemos-binding";
import { ensureNativeTitle, type NativeTitleEditor } from "../src/native-document-title";
import { nativeEditorCodeLock } from "../src/native-editor-guard";
import { formatMnemosWorkPrompt } from "../src/mnemos-agent-guide";

const T0 = 1_000_000;

describe("автопривязка встроенного документа к Mnemos", () => {
  it("привязка хранит версию документа, от которой правит редактор; чужая форма версии отвергается", () => {
    const head = "a".repeat(64);
    expect(validateMnemosBinding({accountId: 1, scope: "p", resource: "d", savedRevision: 3, savedHead: head}))
      .toEqual({accountId: 1, scope: "p", resource: "d", savedRevision: 3, savedHead: head});
    expect(validateMnemosBinding({accountId: 1, scope: "p", resource: "d"})).toEqual({accountId: 1, scope: "p", resource: "d"});
    for (const savedHead of ["", "A".repeat(64), "a".repeat(63), 5]) expect(() => validateMnemosBinding({accountId: 1, scope: "p", resource: "d", savedHead})).toThrow();
  });

  it("документ создаёт одна вкладка: второй захват при живом первом не выдаётся", () => {
    const first = claimMnemosCreation({}, 7, "project", "Статус проекта", T0, "claim-1");
    expect(first.creation).toEqual({claim: "claim-1", accountId: 7, scope: "project", name: "Статус проекта", at: T0});
    const second = claimMnemosCreation(first.entry, 7, "project", "Статус проекта", T0 + 1000, "claim-2");
    expect(second.creation).toBeNull();
    expect(second.entry).toBe(first.entry);
  });

  it("брошенный захват без квитанции ничего не создал и перехватывается по сроку", () => {
    const first = claimMnemosCreation({}, 7, "project", "Док", T0, "claim-1");
    expect(mnemosDocumentState(first.entry, null, T0 + MNEMOS_CLAIM_TTL_MS + 1).creation).toBeNull();
    const again = claimMnemosCreation(first.entry, 7, "project", "Док", T0 + MNEMOS_CLAIM_TTL_MS + 1, "claim-2");
    expect(again.creation?.claim).toBe("claim-2");
  });

  it("захват с квитанцией виден любой вкладке для повтора той же заявки и не перехватывается раньше срока", () => {
    const first = claimMnemosCreation({}, 7, "project", "Док", T0, "claim-1");
    const sealed = recordMnemosReceipt(first.entry, "claim-1", "receipt-1");
    expect(mnemosDocumentState(sealed, null, T0 + MNEMOS_CLAIM_TTL_MS + 1).creation?.receipt).toBe("receipt-1");
    expect(claimMnemosCreation(sealed, 7, "project", "Док", T0 + MNEMOS_CLAIM_TTL_MS + 1, "claim-2").creation).toBeNull();
    expect(claimMnemosCreation(sealed, 7, "project", "Док", T0 + MNEMOS_RECEIPT_TTL_MS + 1, "claim-2").creation?.claim).toBe("claim-2");
    // Чужой или сменившийся захват квитанцию не перезаписывает.
    expect(() => recordMnemosReceipt(sealed, "claim-2", "receipt-2")).toThrow();
    expect(() => recordMnemosReceipt(sealed, "claim-1", "receipt-2")).toThrow();
  });

  it("после привязки создание не захватывается, а привязка переживает любую вкладку", () => {
    const bound = setMnemosBinding({accountId: 7, scope: "project", resource: "node-1", savedRevision: 3});
    expect(claimMnemosCreation(bound, 7, "project", "Док", T0, "claim-1").creation).toBeNull();
    const state = mnemosDocumentState(bound, {accountId: 7, projectId: "project", title: "Проект"}, T0);
    expect(state).toEqual({binding: {accountId: 7, scope: "project", resource: "node-1", savedRevision: 3}, creation: null, project: null});
    expect(setMnemosBinding(null)).toEqual({});
    expect(() => validateMnemosBinding({accountId: 7, scope: "", resource: "node"})).toThrow();
    expect(() => claimMnemosCreation({}, 7, "project", "a/b", T0, "c")).toThrow();
  });

  it("проект — первый проект беседы и только для того, кто начал беседу", () => {
    const meta = {projectContext: {accountId: 7, projectId: "p1", title: "Продажи", creatorId: "alice",
      projects: [{accountId: 7, projectId: "p1", title: "Продажи", pinnedBy: "user" as const}, {accountId: 7, projectId: "p2", title: "Склад", pinnedBy: "agent" as const}]}};
    expect(mnemosProjectForChat(meta, "alice")).toEqual({accountId: 7, projectId: "p1", title: "Продажи"});
    expect(mnemosProjectForChat(meta, "bob")).toBeNull();
    expect(mnemosProjectForChat({projectContext: {...meta.projectContext, projects: []}}, "alice")).toBeNull();
    expect(mnemosProjectForChat(undefined, "alice")).toBeNull();
  });
});

function docEditor(document: Record<string, unknown>) {
  const operations: Record<string, unknown>[] = [];
  const editor: NativeTitleEditor = {
    async getDocument() { return document; },
    async applyOperation(op) { operations.push(op); if (typeof op.title === "string") document.title = op.title; return {status: "applied"}; },
  };
  return {editor, operations};
}

describe("название встроенного документа", () => {
  it("пустой «Новый документ» не переименовывается", async () => {
    const {editor, operations} = docEditor({revision: 1, title: "Новый документ", blocks: []});
    expect(await ensureNativeTitle("cloudflareos.document", editor)).toBeNull();
    expect(operations).toEqual([]);
  });

  it("название берётся из первого заголовка и пишется в редактор без правки блоков", async () => {
    const {editor, operations} = docEditor({revision: 4, restoreRevision: 2, title: "Новый документ", blocks: [
      {id: "b1", html: "<p>Черновик для совета</p>"},
      {id: "b2", html: "<h1 data-block-id=\"b2\">Текущий статус&nbsp;проекта</h1>"},
    ]});
    expect(await ensureNativeTitle("cloudflareos.document", editor, async () => { throw new Error("модель не нужна"); }))
        .toEqual({title: "Текущий статус проекта", generated: true});
    expect(operations).toEqual([{title: "Текущий статус проекта", restoreRevision: 2, upserts: [], deletes: [], senderId: "mnemos-title"}]);
  });

  it("заданное название не трогается", async () => {
    const {editor, operations} = docEditor({revision: 4, title: "План", blocks: [{id: "b1", html: "<h1>Другое</h1>"}]});
    expect(await ensureNativeTitle("cloudflareos.document", editor)).toEqual({title: "План", generated: false});
    expect(operations).toEqual([]);
  });

  it("без заголовка и с длинной строкой название даёт модель, английский ответ отбрасывается", async () => {
    const long = "Сегодня мы обсуждали итоги квартала, перенос сроков поставки оборудования, найм двух инженеров и бюджет на следующий год";
    const russian = docEditor({revision: 2, title: "Новый документ", blocks: [{id: "b1", html: `<p>${long}</p>`}]});
    expect((await ensureNativeTitle("cloudflareos.document", russian.editor, async () => "«Итоги квартала»"))?.title).toBe("Итоги квартала");
    const english = docEditor({revision: 2, title: "Новый документ", blocks: [{id: "b1", html: `<p>${long}</p>`}]});
    expect((await ensureNativeTitle("cloudflareos.document", english.editor, async () => "Quarter results"))?.title)
        .toBe("Сегодня мы обсуждали итоги квартала, перенос сроков поставки…");
  });

  it("таблица получает название из первой текстовой ячейки через операцию структуры", async () => {
    const {editor, operations} = docEditor({revision: 3, title: "Новая таблица", sheetOrder: ["s1"], sheets: {},
      cells: {s1: {B2: {value: "1250"}, A1: {value: "Бюджет отдела"}, C1: {value: "=SUM(B2:B3)"}}}});
    expect((await ensureNativeTitle("cloudflareos.spreadsheet", editor))?.title).toBe("Бюджет отдела");
    expect(operations[0]).toEqual({restoreRevision: 0, structure: {title: "Бюджет отдела"}, senderId: "mnemos-title"});
  });

  it("презентация: образцы стартовой колоды не считаются текстом, при смене ревизии запись повторяется", async () => {
    const deck = {revision: 5, slides: [{blocks: [{type: "title", props: {text: "Название презентации"}}]}, {blocks: [{type: "title", props: {text: "Итоги года"}}]}]};
    const calls: [number, string][] = [];
    const editor: NativeTitleEditor = {
      async getDocument() { return deck; },
      async mutateDocument(revision, method) { calls.push([revision, method]); if (calls.length === 1) { deck.revision = 6; return {applied: false}; } return {applied: true}; },
    };
    expect((await ensureNativeTitle("cloudflareos.presentation", editor))?.title).toBe("Итоги года");
    expect(calls).toEqual([[5, "setDeck"], [6, "setDeck"]]);
  });
});

describe("код встроенных редакторов агент не меняет", () => {
  const output = (id: string): BlueprintOutput => ({id, noun: "документ", plural: "документы", icon: "document" as BlueprintOutput["icon"]});

  it("файловые инструменты отказывают для документа, таблицы и презентации с понятной подсказкой", () => {
    const lock = nativeEditorCodeLock(output("document"), "STATUS_DOC");
    expect(lock).toContain("код не меняется агентом");
    expect(lock).toContain("env.STATUS_DOC.setDocument({title, blocks");
    expect(lock).toContain("меню скачивания");
    expect(nativeEditorCodeLock(output("spreadsheet"), "T")).toContain("env.T.applyOperation");
    expect(nativeEditorCodeLock(output("presentation"), "P")).toContain("\"setDeck\"");
  });

  it("обычный гаджет и гаджет с другим форматом править можно", () => {
    expect(nativeEditorCodeLock(undefined, "APP")).toBeNull();
    expect(nativeEditorCodeLock(output("dashboard"), "APP")).toBeNull();
  });

  it("подсказка Mnemos ведёт документы во встроенный формат, а не в Markdown-черновик", () => {
    const text = formatMnemosWorkPrompt("MNEMOS");
    expect(text).toContain("создай гаджет из встроенного формата");
    expect(text).toContain("Markdown-черновик — не Word-документ");
  });
});
