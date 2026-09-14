/** Типы биндинга MNEMOS: документы и ограниченные административные предложения. */
export const MNEMOS_LIBRARY_TYPES = `
/**
 * Опубликованные документы команды в Mnemos. Записи каталога — проекты; их id
 * передаются в searchProject(), readDocument() и saveDraft(). Каждое чтение
 * записывается как наблюдение. Личные черновики агент сохраняет сразу по выданным правам.
 * Проект или доступ сотрудника сначала предлагается человеку в карточке подтверждения.
 */
interface MnemosLibrary {
  /** Подключить существующий проект к агенту после явного подтверждения владельца.
   * project — точное имя или ID; requestId стабилен при повторе. Права людей не изменяются. */
  proposeConnectProject(requestId: string, project: string): Promise<MnemosAdminProposal>;
  /** Личные документы владельца, включая загрузки. Только проекты в scope агента.
   * cursor берётся из next_cursor; пустая строка начинает список. Не работает в общей беседе. */
  listPersonalDocuments(project: string, cursor?: string): Promise<{head: string; documents: {node_id: string; name: string; content_type: string}[]; next_cursor: string}>;
  /** Текст личной версии по node_id из listPersonalDocuments; без публикации и fallback.
   * Только text/plain и text/markdown до 256 КиБ. Недоступность не означает отсутствие файла.
   * При отказе по scope предложите подключение через proposeConnectProject и дождитесь подтверждения владельца. */
  readPersonalDocument(project: string, node: string): Promise<MnemosDocument>;
  /** Предложить создание проекта. Сначала покажется короткое подтверждение человеку.
   * requestId — стабильный уникальный ключ: повтор с тем же ключом не создаёт второй проект.
   * slug — краткое имя латиницей, цифрами и дефисами. Дождитесь подтверждения результата. */
  proposeCreateProject(requestId: string, name: string, slug: string): Promise<MnemosAdminProposal>;
  /** Предложить файловый доступ существующего сотрудника к проекту и области.
   * person/project — идентификаторы или точные имена; сервер отвергает неоднозначные совпадения.
   * domain — область или пустая строка для всех.
   * Нельзя выдумывать сотрудников или считать предложение выполненным до подтверждения.
   * Повторяйте requestId только с теми же параметрами. */
  proposeProjectAccess(requestId: string, person: string, project: string, domain: string, mode: "read" | "write"): Promise<MnemosAdminProposal>;
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
interface MnemosAdminProposal {
  action: number;
  summary: string;
  status: "pending" | "approved" | "rejected" | "applied";
  result?: Record<string, string>;
}
`;
