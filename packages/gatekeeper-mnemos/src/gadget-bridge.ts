// Мост «сборка opencode → узел гаджета» (ADR 0028 Mnemos, этап 5).
//
// Служба рабочих мест отдаёт проверенную сборку задачи гаджета: манифест из dist/gadget.json и два
// модуля. Здесь сборка ещё раз проверяется строгим форматом приложения (gadget-app.ts) и сохраняется
// ЛИЧНОЙ версией узла правами человека: новый узел в проекте или новая версия уже созданного.
// Ничего не публикуется и не запускается в общем экземпляре: это делает человек из шапки файла.
import { GADGET_APP_MIME, gadgetAppText, parseGadgetAppText, type GadgetAppDocument } from "@gadgets/workshop-shared/gadget-app";
import type { MnemosAccountSession } from "./account-session.ts";
import type { WorkspaceGadgetBuild } from "./workspace-tasks.ts";

export type GadgetSaveAPI = Pick<MnemosAccountSession, "openDraft" | "beginNativeUpload" | "createPrivateDocument" | "readDraftDocument" | "saveDraftDocument">;

/** Итог сохранения: узел, голова личной ветки после записи и манифест, как он лёг в узел. */
export interface SavedGadget { resource: string; head: string; title: string; collaborative: boolean; session: boolean; created: boolean }

export class GadgetBuildError extends Error {
  constructor(message: string) { super(message); this.name = "GadgetBuildError"; }
}

/** Содержимое узла из сборки. session — из кода, как при «Сохранить в проект»: сервер объявил session(caller). */
export function gadgetDocumentFromBuild(build: WorkspaceGadgetBuild): GadgetAppDocument {
  const server = build.modules["server.js"];
  const session = /\bsession\s*\(/.test(server);
  if (build.manifest.collaborative && !session) throw new GadgetBuildError("Для общих данных в server.js нужен метод session(caller): по нему приложение знает, кто вызывает.");
  return {
    manifest: { title: build.manifest.name.trim(), description: build.manifest.description, collaborative: build.manifest.collaborative, session, formatVersion: 1,
      permissions: build.manifest.permissions as GadgetAppDocument["manifest"]["permissions"] },
    modules: { "client.js": build.modules["client.js"], "server.js": server },
  };
}

async function sha256(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return btoa(String.fromCharCode(...digest));
}

async function upload(api: GadgetSaveAPI, storageOrigin: string, fetcher: typeof fetch, project: string, bytes: Uint8Array): Promise<string> {
  const checksum = await sha256(bytes);
  const ticket = await api.beginNativeUpload(project, bytes.length, checksum);
  const url = new URL(ticket.url), origin = new URL(storageOrigin);
  // Тело уходит прямо в хранилище по выданному адресу; адрес обязан быть хранилищем этой установки.
  if (origin.protocol !== "https:" || origin.origin !== storageOrigin || url.origin !== origin.origin || url.username || url.password || url.hash ||
      ticket.method !== "PUT" || ticket.content_length !== bytes.length || ticket.checksum_header.toLowerCase() !== "x-amz-checksum-sha256" || ticket.checksum_value !== checksum) {
    throw new Error("Хранилище Mnemos выдало неожиданный адрес выгрузки.");
  }
  const response = await fetcher(url, { method: "PUT", redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { [ticket.checksum_header]: checksum }, body: bytes });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Хранилище Mnemos не приняло файл гаджета.");
  return ticket.upload_id;
}

/**
 * Сохранить сборку личной версией. resource — узел гаджета, созданный прошлым сохранением этой же
 * работы: тогда пишется новая версия того же узла; без него создаётся новый узел в проекте.
 */
export async function saveGadgetBuild(api: GadgetSaveAPI, storageOrigin: string, fetcher: typeof fetch, project: string, build: WorkspaceGadgetBuild, resource?: string, request: string = crypto.randomUUID()): Promise<SavedGadget> {
  let text: string, manifest: GadgetAppDocument["manifest"];
  try {
    text = gadgetAppText(gadgetDocumentFromBuild(build));
    // Та же проверка, что у оболочки при открытии: узел, который не откроется, не записывается.
    manifest = parseGadgetAppText(text).document.manifest;
  } catch (error) {
    throw error instanceof GadgetBuildError ? error : new GadgetBuildError((error as Error)?.message || "Сборка гаджета не подходит формату приложения.");
  }
  const bytes = new TextEncoder().encode(text);
  if (resource) {
    const doc = await api.readDraftDocument(project, resource);
    // Не заменять чужой файл: только существующий узел приложения.
    if (!doc.exists || doc.conflicted || doc.content_type !== GADGET_APP_MIME) throw new Error("Файл гаджета в проекте удалён, в конфликте или заменён другим файлом.");
    const uploadId = await upload(api, storageOrigin, fetcher, project, bytes);
    const saved = await api.saveDraftDocument(project, resource, uploadId, doc.head);
    return { resource, head: saved.head, title: manifest.title, collaborative: manifest.collaborative, session: manifest.session, created: false };
  }
  const { head } = await api.openDraft(project);
  const uploadId = await upload(api, storageOrigin, fetcher, project, bytes);
  const created = await api.createPrivateDocument(project, { request_id: request, expected_head: head, parent_id: "", name: manifest.title.replace(/[/\\]/g, "-"),
    content_type: GADGET_APP_MIME, upload_id: uploadId, message: "Гаджет от агента кода" });
  return { resource: created.node_id, head: created.head, title: manifest.title, collaborative: manifest.collaborative, session: manifest.session, created: true };
}
