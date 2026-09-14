/** Типы, которые агент видит у биндинга MNEMOS. Чтение и запись личного черновика; публикации нет. */
export const MNEMOS_LIBRARY_TYPES = `
/**
 * Опубликованные документы команды в Mnemos. Записи каталога — проекты; их id
 * передаются в searchProject(), readDocument() и saveDraft(). Каждое чтение
 * записывается как наблюдение. Личные черновики агент сохраняет сразу по выданным правам.
 */
interface MnemosLibrary {
  /** Проекты, доступные владельцу аккаунта. */
  listProjects(): Promise<MnemosProject[]>;
  /** Гибридный поиск (полнотекст + смысл) по опубликованным документам одного проекта; до 20 совпадений. */
  searchProject(project: string, query: string): Promise<MnemosSearchResult>;
  /** Опубликованная версия одного документа. document — идентификатор из searchProject()
   *  или путь внутри проекта, например "docs/plan.md". */
  readDocument(project: string, document: string): Promise<MnemosDocument>;
  /** Сохранить существующий текстовый документ в личный черновик владельца без ожидания одобрения.
   * text/plain или text/markdown, до 256 КиБ. Конкурирующая правка приводит к отказу; перечитайте документ.
   * Публикация в общую память выполняется отдельно человеком после согласования. */
  saveDraft(project: string, document: string, content: string): Promise<MnemosDraftProposal>;
  /** Создать личный текстовый черновик сразу, без ожидания одобрения.
   * parent — id опубликованной папки или "" для корня, name — имя файла без пути.
   * mediaType — text/plain или text/markdown (по умолчанию), текст до 256 КиБ.
   * Возвращает id созданного документа. Публикации этот метод не выполняет. */
  createDraft(project: string, parent: string, name: string, content: string, mediaType?: "text/plain" | "text/markdown"): Promise<MnemosDraftProposal>;
}

interface MnemosProject {
  id: string;             // передаётся в searchProject(), readDocument() и saveDraft()
  name: string;
  slug: string;
}

interface MnemosSearchHit {
  document: string;       // идентификатор документа для readDocument()
  name: string;           // имя файла
  text: string;           // совпавший фрагмент
  ordinal: number;        // номер фрагмента внутри документа
}

interface MnemosSearchResult {
  hits: MnemosSearchHit[];
  indexPending: boolean;  // часть документов ещё не проиндексирована
  degraded: boolean;      // поиск шёл без векторной части
}

interface MnemosDocument {
  document: string;       // идентификатор документа
  name: string;           // имя файла
  text: string;           // текст опубликованной версии
  mediaType: string;
  truncated: boolean;     // текст обрезан по лимиту размера
}

interface MnemosDraftProposal {
  action: number;         // идентификатор выполненной записи
  document: string;       // идентификатор документа
  name: string;           // имя файла
  status: "saved";        // личный черновик записан
  head: string;           // сохранённая версия
}
`;
