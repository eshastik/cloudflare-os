// Редактор документа в Telegram Mini App (ADR 0027 Mnemos, раздел 6).
//
// Mini App не получает сессию сайта. После проверки initData сервер выдаёт короткую сессию,
// привязанную к одному документу (беседа + вывод), владельцу и его боту. По ней отдельная точка RPC
// отдаёт только то, что нужно редактору этого документа: код экрана, связь с сервером редактора,
// сохранение в Mnemos и версии. Других документов, бесед, настроек и агентов через неё не достать.

import type { RpcStub, RpcTarget } from "capnweb";
import type { GatekeeperDownloadTicket, GatekeeperUploadTicket } from "./gatekeeper.js";
import type { NativeDocumentFormat } from "./native-document.js";

/** Адрес WebSocket точки RPC Mini App. Сессия передаётся первым вызовом, не в cookie. */
export const MINI_APP_RPC_PATH = "/api/telegram-app/rpc";

/** Адрес фрейма редактора Mini App. Фрейм грузится отдельным адресом со своим заголовком CSP,
 *  а не srcdoc: srcdoc наследует политику страницы, и странице пришлось бы разрешать data:-скрипты. */
export const MINI_APP_EDITOR_FRAME_PATH = "/api/telegram-app/editor-frame";

/** Политика фрейма редактора — та же, что у фрейма гаджета на сайте (gadgetSandbox.ts):
 *  код редактора и Cap'n Web подключаются data:-модулями, сеть закрыта.
 *  sandbox стоит в самом заголовке, а не только атрибутом тега: чужой сайт встроит этот адрес без
 *  атрибута, и принятый сообщением код исполнился бы в происхождении установки. frame-ancestors —
 *  второй барьер: встраивает своя страница Mini App, а её в Telegram Web — web.telegram.org
 *  (директива проверяет всех предков). */
export const MINI_APP_EDITOR_FRAME_CSP =
  "sandbox allow-scripts; frame-ancestors 'self' https://web.telegram.org; " +
  "default-src 'none'; frame-src 'none'; script-src data: 'unsafe-inline'; style-src data: 'unsafe-inline'; " +
  "img-src data:; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'";

/** Разметка фрейма: сообщает странице, что готов, и заменяет себя разметкой редактора, которую
 *  страница собирает тем же createSandboxedHtml, что и сайт. Принимает её только от родителя. */
export const MINI_APP_EDITOR_FRAME_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body><script>
addEventListener("message", function onHtml(event) {
  if (event.source !== parent || !event.data || event.data.type !== "editor-frame-html" || typeof event.data.html !== "string") return;
  removeEventListener("message", onHtml);
  document.open();
  document.write(event.data.html);
  document.close();
});
parent.postMessage({ type: "editor-frame-ready" }, "*");
</script></body></html>`;

/** Вид сессии Mini App: «<номер объекта бота>.<секрет>». */
export const MINI_APP_SESSION = /^[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/;

/** Состояние документа в Mnemos для этого человека.
 *  bound — документ сохранён в Mnemos; project — ещё нет, но есть проект беседы, куда его можно
 *  сохранить; none — сохранить в Mnemos из Telegram некуда (выбор проекта — на сайте). */
export type MiniAppMnemosState =
  | { kind: "bound"; access: "owner" | "write" | "read";
      /** Версия в Mnemos, с которой правит редактор; null — неизвестна (берётся текущая). */
      savedHead: string | null;
      /** Ревизия редактора, вошедшая в последнее сохранение; null — неизвестна. */
      savedRevision: number | null }
  | { kind: "project"; projectTitle: string }
  | { kind: "none" };

/** Что Mini App показывает о документе. */
export type MiniAppDocumentInfo = {
  /** Название документа. */
  title: string;
  /** Формат редактора; `cloudflareos.app` — приложение (ADR 0028): экран без сохранения, код и версии — на сайте. */
  format: NativeDocumentFormat | "cloudflareos.app";
  /** Цвет акцента человека (HEX). */
  accent: string;
  /** Документ в Mnemos. */
  mnemos: MiniAppMnemosState;
  /** Точный источник хранилища Mnemos для прямой загрузки и скачивания; пусто — хранилища нет. */
  storageOrigin: string;
  /** Адрес беседы этого документа на сайте. */
  sitePath: string;
};

/** Версия документа в Mnemos. */
export type MiniAppVersion = {
  /** Опознаватель версии для version(); другой документ им не выбрать. */
  id: string;
  /** Когда записана (ISO 8601); пусто — неизвестно. */
  recordedAt: string;
  /** Кто записал: имя человека или агента; пусто — сам человек. */
  author: string;
  /** Человек, по чьей просьбе записал агент; пусто — записал человек. */
  onBehalfOf: string;
};

/** Сохранение этого документа в Mnemos: права человека проверяет Mnemos на каждом вызове. */
export interface MiniAppWriter extends RpcTarget {
  /** Текущая версия документа в Mnemos. */
  head(): Promise<string>;
  /** Билет на прямую загрузку тела (до 4 МиБ) в хранилище. */
  issue(expectedHead: string, size: number, checksum: string): Promise<GatekeeperUploadTicket>;
  /** Записать загруженное как новую версию от expectedHead. Документ изменили — ошибка DOCUMENT_CHANGED.
   *  revision — ревизия редактора, вошедшая в версию. Возвращает новую версию. */
  save(expectedHead: string, uploadId: string, revision: number | null): Promise<string>;
}

/** Первое сохранение документа в проект беседы. Проект выбирает сервер, не страница. */
export interface MiniAppCreator extends RpcTarget {
  /** Билет на прямую загрузку тела в хранилище. */
  issue(size: number, checksum: string): Promise<GatekeeperUploadTicket>;
  /** Создать документ из загруженного. Повтор после сбоя не создаёт второй документ. */
  save(uploadId: string, revision: number | null): Promise<void>;
}

/** Одна версия документа для скачивания: доступ перепроверяется до и после передачи. */
export interface MiniAppVersionDownload extends RpcTarget {
  /** Билет на прямое скачивание. */
  issue(): Promise<GatekeeperDownloadTicket & { content_type: string }>;
  /** Перепроверить доступ после скачивания. */
  validate(): Promise<void>;
}

/** Всё, что сессия Mini App может сделать: один документ. */
export interface MiniAppDocument extends RpcTarget {
  /** Название, формат, акцент и состояние в Mnemos. */
  describe(): Promise<MiniAppDocumentInfo>;
  /** Код экрана редактора; null — у документа нет экрана. */
  getUiBundle(): Promise<{ jsCode: string } | null>;
  /** Связь с сервером редактора этого документа: только методы правки и снимка. */
  connectEditor(): Promise<RpcStub<RpcTarget>>;
  /** Сохранение в Mnemos; ошибка — документ не в Mnemos или только для чтения. */
  writer(): Promise<RpcStub<MiniAppWriter>>;
  /** Первое сохранение в проект беседы. name — название из шапки редактора. */
  creator(name: string): Promise<RpcStub<MiniAppCreator>>;
  /** Версии документа, новые сверху; cursor — продолжение списка, пусто — начало. */
  versions(cursor: string): Promise<{ versions: MiniAppVersion[]; nextCursor: string }>;
  /** Одна версия из списка versions(). */
  version(id: string): Promise<RpcStub<MiniAppVersionDownload>>;
  /** Закрыть: сессия удаляется, связь закрывается. Обрыв связи делает то же. */
  close(): Promise<void>;
}

/** Корень точки RPC Mini App: без сессии ничего не отдаёт. */
export interface MiniAppPublicApi extends RpcTarget {
  /** Открыть документ по сессии Mini App. Истёкшая, отозванная или чужая сессия — отказ. */
  open(session: string): Promise<MiniAppDocument>;
}
