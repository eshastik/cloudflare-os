// Мост «сборка opencode → узел гаджета» (ADR 0028 Mnemos, этап 5).
//
// Служба рабочих мест отдаёт проверенную сборку задачи гаджета: манифест из dist/gadget.json и два
// модуля. Здесь сборка ещё раз проверяется строгим форматом приложения (gadget-app.ts) и сохраняется
// ЛИЧНОЙ версией узла правами человека: новый узел в проекте или новая версия уже созданного.
// Ничего не публикуется и не запускается в общем экземпляре: это делает человек из шапки файла.
import { GADGET_APP_MIME, gadgetAppSha256, gadgetAppText, parseGadgetAppText, type GadgetAppDocument } from "@gadgets/workshop-shared/gadget-app";
import type { AccountStorage, MnemosAccountSession } from "./account-session.ts";
import { MnemosAPIError, type PrivateDocumentCreate } from "./mnemos-api.ts";
import type { WorkspaceGadgetBuild } from "./workspace-tasks.ts";

export type GadgetSaveAPI = Pick<MnemosAccountSession, "openDraft" | "beginNativeUpload" | "createPrivateDocument" | "readDraftDocument" | "saveDraftDocument">;

/** Итог сохранения: узел, голова личной ветки после записи и манифест, как он лёг в узел. */
/** bodySha256 — hex SHA-256 всех байтов тела узла: та же величина, что sha256_hex у app-code и сумма версии
 *  у экземпляра (gadgetAppSha256); по ней служба привязывает исходники к версии. */
export interface SavedGadget { resource: string; head: string; title: string; description: string; collaborative: boolean; session: boolean; created: boolean; bodySha256: string }

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

/** Узел гаджета можно править: он есть в личной ветке человека, не в конфликте и это узел приложения.
 * Личную ветку пишет только её хозяин, поэтому это и есть право правки узла. */
export async function checkGadgetEditable(api: Pick<GadgetSaveAPI, "readDraftDocument">, project: string, resource: string) {
  const doc = await api.readDraftDocument(project, resource);
  if (!doc.exists || doc.conflicted || doc.content_type !== GADGET_APP_MIME) throw new Error("Файл гаджета в проекте удалён, в конфликте или заменён другим файлом.");
  return doc;
}

/** Сумма копии проверяется после права правки, до переноса исходников автора. */
export async function checkGadgetCopyBuild(api: Pick<GadgetSaveAPI, "readDraftDocument">, project: string, resource: string, expected: string, currentBodySha256: (head: string) => Promise<string>): Promise<void> {
  const copy = await checkGadgetEditable(api, project, resource);
  if (await currentBodySha256(copy.head) !== expected) throw new GadgetBuildError("Версия копии изменилась. Исходники автора не заменят вашу правку: откройте копию заново.");
}

/**
 * Квитанция создания узла гаджета. Тело запроса к Mnemos записывается ДО вызова: повтор после
 * потерянного ответа посылает то же тело с тем же request_id, и Mnemos отдаёт уже созданный узел,
 * а не создаёт второй. node — узел, когда ответ получен.
 */
export interface GadgetCreateReceipt { project: string; body: PrivateDocumentCreate; sha: string; node?: string }
export interface GadgetReceipts { get(key: string): GadgetCreateReceipt | undefined; put(key: string, value: GadgetCreateReceipt): void }

const RECEIPT = "gadgetCreate:", RECEIPTS = "gadgetCreateIndex", MAX_RECEIPTS = 100;
/** Квитанции в хранилище подключения; хранятся последние MAX_RECEIPTS. */
export function gadgetReceipts(kv: Pick<AccountStorage, "get" | "put" | "delete">): GadgetReceipts {
  return {
    get: key => kv.get<GadgetCreateReceipt>(RECEIPT + key),
    put: (key, value) => {
      kv.put(RECEIPT + key, value);
      const keys = [key, ...(kv.get<string[]>(RECEIPTS) ?? []).filter(k => k !== key)];
      for (const old of keys.slice(MAX_RECEIPTS)) kv.delete(RECEIPT + old);
      kv.put(RECEIPTS, keys.slice(0, MAX_RECEIPTS));
    },
  };
}

/** Квитанция от беседы: короткий ключ без служебных знаков. */
export function validGadgetRequest(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,100}$/.test(value);
}

/**
 * Сохранить сборку личной версией. resource — узел гаджета, созданный прошлым сохранением этой же
 * работы: тогда пишется новая версия того же узла; без него создаётся новый узел в проекте.
 * receipts — квитанции создания по ключу request: повтор создания после потерянного ответа даёт
 * тот же узел (и новую версию в нём, если сборка другая), а не второй узел.
 * currentBodySha256 читает сумму текущей личной версии служебным путём; прежняя сборка не создаёт пустую версию.
 */
/** Отказ Mnemos при сохранении с этапом и кодом ответа: «Mnemos request failed» не говорит,
 *  что делать, а 29.09 по нему и по журналам нельзя было понять, где упало сохранение. */
function describeSaveFailure(stage: string, error: unknown): unknown {
  if (!(error instanceof MnemosAPIError) || error.message !== "Mnemos request failed") return error;
  const why = error.status === 401 ? "вход в Mnemos устарел или не подтверждён — попросите сохранить ещё раз; если повторится, войдите заново"
    : error.status === 403 ? "нет права записи в этот проект"
    : error.status === 503 || error.status === 502 ? "Mnemos не ответил — попросите сохранить ещё раз"
    : "попросите сохранить ещё раз";
  return new Error(`Гаджет не сохранён: Mnemos отказал на шаге «${stage}» (HTTP ${error.status}${error.code ? `, ${error.code}` : ""}); ${why}.`);
}

export async function saveGadgetBuild(api: GadgetSaveAPI, storageOrigin: string, fetcher: typeof fetch, project: string, build: WorkspaceGadgetBuild, resource?: string, request: string = crypto.randomUUID(), receipts?: GadgetReceipts, currentBodySha256?: (node: string, head: string) => Promise<string>, keepUnchangedSources?: (node: string, bodySha256: string) => Promise<void>): Promise<SavedGadget> {
  const stage = { name: "проверка сборки" };
  try {
    return await saveGadgetBuildSteps(api, storageOrigin, fetcher, project, build, stage, resource, request, receipts, currentBodySha256, keepUnchangedSources);
  } catch (error) {
    throw describeSaveFailure(stage.name, error);
  }
}

async function saveGadgetBuildSteps(api: GadgetSaveAPI, storageOrigin: string, fetcher: typeof fetch, project: string, build: WorkspaceGadgetBuild, stage: { name: string }, resource?: string, request: string = crypto.randomUUID(), receipts?: GadgetReceipts, currentBodySha256?: (node: string, head: string) => Promise<string>, keepUnchangedSources?: (node: string, bodySha256: string) => Promise<void>): Promise<SavedGadget> {
  let text: string, manifest: GadgetAppDocument["manifest"];
  try {
    text = gadgetAppText(gadgetDocumentFromBuild(build));
    // Та же проверка, что у оболочки при открытии: узел, который не откроется, не записывается.
    manifest = parseGadgetAppText(text).document.manifest;
  } catch (error) {
    throw error instanceof GadgetBuildError ? error : new GadgetBuildError((error as Error)?.message || "Сборка гаджета не подходит формату приложения.");
  }
  const bytes = new TextEncoder().encode(text);
  const summary = { title: manifest.title, description: manifest.description, collaborative: manifest.collaborative, session: manifest.session, bodySha256: await gadgetAppSha256(text) };
  const newVersion = async (node: string) => {
    // Не заменять чужой файл: только существующий узел приложения.
    stage.name = "чтение прежней версии";
    const doc = await checkGadgetEditable(api, project, node);
    if (currentBodySha256 && await currentBodySha256(node, doc.head) === summary.bodySha256) {
      // Исходники могли измениться без изменения сборки или не сохраниться при прежнем отказе.
      await keepUnchangedSources?.(node, summary.bodySha256);
      throw new GadgetBuildError("Сборка гаджета не изменилась.");
    }
    stage.name = "выгрузка файла";
    const uploadId = await upload(api, storageOrigin, fetcher, project, bytes);
    stage.name = "запись новой версии";
    return (await api.saveDraftDocument(project, node, uploadId, doc.head)).head;
  };
  if (resource) return { resource, head: await newVersion(resource), ...summary, created: false };
  const sha = await sha256(bytes);
  let fresh = request;
  const known = receipts?.get(request);
  if (known && known.project === project) {
    let node = known.node, head = "";
    if (!node) {
      stage.name = "повтор создания файла";
      try {
        const replay = await api.createPrivateDocument(project, known.body);
        node = replay.node_id; head = replay.head;
        receipts!.put(request, { ...known, node });
      } catch (error) {
        // Отказ 4xx: прежний вызов не дошёл до Mnemos (или его тело уже не принять) — узла нет,
        // создаётся новый со свежим request_id. Сбой сети и 5xx — не ответ: квитанция остаётся.
        if (!(error instanceof MnemosAPIError) || error.status >= 500) throw error;
        fresh = crypto.randomUUID();
      }
    }
    if (node) {
      // Тот же узел; другая сборка ложится в него новой версией.
      if (known.sha === sha) return { resource: node, head: head || (await checkGadgetEditable(api, project, node)).head, ...summary, created: true };
      return { resource: node, head: await newVersion(node), ...summary, created: true };
    }
  }
  stage.name = "открытие личной ветки проекта";
  const { head } = await api.openDraft(project);
  stage.name = "выгрузка файла";
  const uploadId = await upload(api, storageOrigin, fetcher, project, bytes);
  const body: PrivateDocumentCreate = { request_id: fresh, expected_head: head, parent_id: "", name: manifest.title.replace(/[/\\]/g, "-"),
    content_type: GADGET_APP_MIME, upload_id: uploadId, message: "Гаджет от агента кода" };
  receipts?.put(request, { project, body, sha });
  stage.name = "создание файла в проекте";
  const created = await api.createPrivateDocument(project, body);
  receipts?.put(request, { project, body, sha, node: created.node_id });
  return { resource: created.node_id, head: created.head, ...summary, created: true };
}
