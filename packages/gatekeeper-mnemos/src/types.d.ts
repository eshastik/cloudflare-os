/** Работа с разрешённым проектом корпоративной памяти. */
export interface MnemosProject {
  /** Текущая принятая версия проекта. */
  state(): Promise<{ sharedHead: string }>;
  /** Поиск только по опубликованным документам, доступным этой сессии. */
  search(query: string, limit?: number): Promise<SearchResults>;
  /** Открывает доступный документ этого проекта; чужой проект недоступен. */
  document(nodeId: string): Promise<MnemosDocument>;
  /** Личная работа текущего пользователя в пределах выданного доступа. */
  draft(): Promise<MnemosDraft>;
}

/** Доступ к одному документу; не позволяет открыть соседние документы. */
export interface MnemosDocument {
  /** Текст принятой версии. Подготовка текста сообщается отдельно от пустого текста. */
  read(maxBytes?: number): Promise<DocumentText>;
  /** Короткоживущая ссылка на файл принятой версии. */
  download(): Promise<FileTicket>;
  /** Изменения этого документа в публикациях; курсор относится только к нему. */
  history(cursor?: string, limit?: number): Promise<HistoryPage>;
  /** Ссылка на значение документа из выбранного события истории. Удаление не скачивается. */
  downloadPublication(eventId: string): Promise<FileTicket>;
}

/** Личный черновик пользователя в одном разрешённом проекте. */
export interface MnemosDraft {
  /** Открывает существующую личную работу либо начинает её с общей версии. */
  open(): Promise<{ head: string }>;
  /** Значение конкретного доступного документа в личной работе. */
  document(nodeId: string): Promise<DraftDocument>;
  /** Готовит прямую загрузку файла. checksumSHA256 — SHA-256 в base64. */
  beginUpload(sizeBytes: number, checksumSHA256: string): Promise<UploadTicket>;
  /** Сохраняет изменения при совпадении ожидаемой головы; скрытые документы не меняются. */
  save(expectedHead: string, changes: DraftChange[], message?: string): Promise<{ head: string }>;
  /** Обновляет личную работу из общей версии; конфликт сохраняется в черновике. */
  update(expectedHead: string): Promise<{ head: string }>;
  /** Принимает изменения при совпадении обеих голов; конфликт остаётся личным. */
  publish(expectedHead: string, expectedSharedHead: string, message?: string): Promise<PublicationResult>;
  /** Скачивает показанную сторону конфликта при совпадении личной головы. */
  download(nodeId: string, expectedHead: string, termIndex: number): Promise<FileTicket>;
}

/** Замена файла из загрузки либо удаление существующего документа. */
export type DraftChange = { nodeId: string; uploadId: string } | { nodeId: string; delete: true };
/** Результат применения личной работы. */
export interface PublicationResult {
  sharedHead: string;
  personalHead: string;
  published: boolean;
  conflicted: boolean;
}
/** Метаданные сторон конфликта без адресов хранения. */
export interface DraftDocument {
  nodeId: string;
  head: string;
  exists: boolean;
  contentType: string;
  conflicted: boolean;
  terms: { present: boolean; negative: boolean }[];
}
/** Текст документа; truncated требует дочитывания, если нужен весь документ. */
export interface DocumentText { nodeId: string; text: string; truncated: boolean; mediaType: string }
/** Результаты поиска принятого содержимого. */
export interface SearchResults {
  hits: { nodeId: string; text: string; ordinal: number }[];
  indexPending: boolean;
}
/** Событие изменения одного документа в общей версии. */
export interface Publication {
  eventId: string;
  head: string;
  recordedAt: string;
  exists: boolean;
  observed: boolean;
  actor: string;
  onBehalfOf: string;
}
/** Следующая страница читается по nextCursor; пустая строка означает конец. */
export interface HistoryPage { events: Publication[]; nextCursor: string }
/** Временная ссылка для прямого скачивания из хранилища. */
export interface FileTicket { url: string; method: "GET"; expiresAt: string; sizeBytes: number; sha256Hex: string }
/** Загрузка выполняется напрямую по URL с выданными заголовками. */
export interface UploadTicket { uploadId: string; url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string }
