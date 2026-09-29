import { describe, expect, it } from "vitest";
import type { AiChatMetadata } from "@gadgets/workshop-shared/api";
import { projectContentType, projectSaveNote, saveChatAttachmentToProject, type ChatAttachmentProjectHost } from "../src/chat-attachment-project";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function meta(withProject = true): AiChatMetadata {
  return {
    id: 7,
    title: "Беседа",
    started: new Date(1_700_000_000_000),
    lastActive: new Date(1_700_000_000_000),
    ...(withProject ? {projectContext: {accountId: 3, projectId: "proj-1", title: "Mnemos",
      projects: [{accountId: 3, projectId: "proj-1", title: "Mnemos"}], creatorId: "user-1", creatorProfileId: "profile-1"}} : {}),
  } as AiChatMetadata;
}

// Mnemos глазами хоста: одна квитанция — один файл.
function host(fail?: Error) {
  let files = new Map<string, {name: string; contentType: string}>();
  let calls: string[] = [];
  let value: ChatAttachmentProjectHost = {
    async saveChatAttachmentToProject(accountId, project, request, file) {
      calls.push(`${accountId}/${project}/${request}`);
      if (fail) throw fail;
      if (!files.has(request)) files.set(request, {name: file.name, contentType: file.contentType});
      return {resource: `node-${[...files.keys()].indexOf(request) + 1}`, name: files.get(request)!.name};
    },
  };
  return {value, files, calls};
}

const docx = {mimeType: DOCX, name: "Отчёт.docx", content: new Uint8Array([0x50, 0x4b, 3, 4, 9])};

describe("saveChatAttachmentToProject", () => {
  it("документ при выбранном проекте ложится файлом, повтор той же загрузки не даёт второй", async () => {
    let mnemos = host();
    let first = await saveChatAttachmentToProject({meta: meta(), userId: "user-1", file: docx, host: mnemos.value});
    let second = await saveChatAttachmentToProject({meta: meta(), userId: "user-1", file: docx, host: mnemos.value});
    expect(first).toEqual({saved: true, accountId: 3, projectId: "proj-1", projectTitle: "Mnemos", resource: "node-1", name: "Отчёт.docx"});
    expect(second).toEqual(first);
    expect(mnemos.files.size).toBe(1);
    expect([...mnemos.files.values()][0].contentType).toBe(DOCX);
    expect(mnemos.calls[0]).toBe(mnemos.calls[1]);
    // Другое содержимое — другая квитанция.
    await saveChatAttachmentToProject({meta: meta(), userId: "user-1", file: {...docx, content: new Uint8Array([0x50, 0x4b, 3, 4, 8])}, host: mnemos.value});
    expect(mnemos.files.size).toBe(2);
  });

  it("без проекта и в чужой беседе файл не создаётся", async () => {
    let mnemos = host();
    expect(await saveChatAttachmentToProject({meta: meta(false), userId: "user-1", file: docx, host: mnemos.value})).toBeUndefined();
    expect(await saveChatAttachmentToProject({meta: meta(), userId: "user-2", file: docx, host: mnemos.value})).toBeUndefined();
    expect(await saveChatAttachmentToProject({meta: undefined, userId: "user-1", file: docx, host: mnemos.value})).toBeUndefined();
    expect(mnemos.calls).toEqual([]);
  });

  it("картинка в проект не кладётся", async () => {
    let mnemos = host();
    let image = {mimeType: "image/png", name: "схема.png", content: new Uint8Array([0x89, 0x50, 0x4e, 0x47])};
    expect(await saveChatAttachmentToProject({meta: meta(), userId: "user-1", file: image, host: mnemos.value})).toBeUndefined();
    expect(mnemos.calls).toEqual([]);
  });

  it("отказ Mnemos — вложение живо, пометка говорит причину", async () => {
    let mnemos = host(new Error("нет права записи в этот проект"));
    let result = await saveChatAttachmentToProject({meta: meta(), userId: "user-1", file: docx, host: mnemos.value});
    expect(result).toEqual({saved: false, projectTitle: "Mnemos", reason: "нет права записи в этот проект"});
    expect(projectSaveNote(result)).toContain("НЕ сохранён в проект «Mnemos»: нет права записи в этот проект");
  });

  it("агент получает имя сохранённого файла", () => {
    expect(projectSaveNote({saved: true, accountId: 3, projectId: "p", projectTitle: "Mnemos", resource: "n", name: "Отчёт (2).docx"}))
      .toContain("сохранён в проект «Mnemos» личной версией под именем «Отчёт (2).docx»");
    expect(projectSaveNote(undefined)).toBe("");
  });
});

describe("projectContentType", () => {
  it("документы — да, картинки и прочее — нет", () => {
    expect(projectContentType("application/pdf", "a.pdf")).toBe("application/pdf");
    expect(projectContentType("application/octet-stream", "a.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(projectContentType("text/plain; charset=utf-8", "a.txt")).toBe("text/plain");
    expect(projectContentType("application/octet-stream", "notes.md")).toBe("text/markdown");
    expect(projectContentType("application/vnd.ms-excel", "data.csv")).toBe("text/csv");
    expect(projectContentType("image/jpeg", "a.jpg")).toBeUndefined();
    expect(projectContentType("text/html", "a.html")).toBeUndefined();
    expect(projectContentType("application/msword", "a.doc")).toBeUndefined();
  });
});
