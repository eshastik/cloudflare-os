// Реестр отображения хода работы агента в беседе: одна точка, где для каждого инструмента агента,
// каждого вида чтения и действия Mnemos и для внешних подключений записано, как шаг называется
// (глагол прошедшего и настоящего времени, что не удалось), как считается в итоговой строке и что
// показывается по раскрытию. Экран беседы берёт подписи только отсюда.
//
// Опись с примерами — docs/design/2026-09-25-отображение-инструментов.md в репозитории mnemos.
import type { AiToolCall } from "@gadgets/workshop-shared/api";
import type { ObservationActivity, ObservationActivityItem } from "@gadgets/workshop-shared/gatekeeper";
import { looksLikeId } from "@gadgets/workshop-shared/code-work";

export type StepIcon =
  | "search" | "document" | "file" | "folder" | "edit" | "create" | "code" | "web" | "link" | "info"
  | "publish" | "share" | "person" | "access" | "delete" | "mail" | "calendar" | "connection"
  | "stop" | "app" | "review" | "budget" | "agent";

export type DisplaySpec = {
  /** Прошедшее время, начало строки: «Искал». */
  past: string;
  /** Настоящее время для идущего шага: «Ищу». */
  present: string;
  /** Продолжение «Не удалось …»: «найти». */
  failed: string;
  /** Счёт в итоговой строке: 1 поиск, 2 поиска, 5 поисков. */
  tally: readonly [string, string, string];
  icon: StepIcon;
  /** Шаг только дополняет предыдущий (итог чтения) и отдельной строкой не показывается. */
  hidden?: boolean;
};

const spec = (past: string, present: string, failed: string, tally: readonly [string, string, string], icon: StepIcon, hidden = false): DisplaySpec =>
  hidden ? { past, present, failed, tally, icon, hidden } : { past, present, failed, tally, icon };

// ---- инструменты агента беседы (workshop-backend/src/agent.ts) ----

export const AGENT_TOOL_DISPLAY: Record<AiToolCall["toolName"], DisplaySpec> = {
  readFile: spec("Прочитал", "Читаю", "прочитать файл", ["файл прочитан", "файла прочитано", "файлов прочитано"], "file"),
  writeFile: spec("Записал", "Записываю", "записать файл", ["файл записан", "файла записано", "файлов записано"], "edit"),
  editFile: spec("Изменил", "Меняю", "изменить файл", ["правка", "правки", "правок"], "edit"),
  describeBinding: spec("Посмотрел подключение", "Смотрю подключение", "посмотреть подключение", ["просмотр подключения", "просмотра подключений", "просмотров подключений"], "link"),
  setBindingHook: spec("Подключил", "Подключаю", "подключить", ["подключение", "подключения", "подключений"], "link"),
  setGadgetBinding: spec("Подключил", "Подключаю", "подключить", ["подключение", "подключения", "подключений"], "link"),
  saveCapsuleAsBinding: spec("Сохранил подключение", "Сохраняю подключение", "сохранить подключение", ["подключение сохранено", "подключения сохранено", "подключений сохранено"], "link"),
  createGadget: spec("Создал", "Создаю", "создать", ["приложение создано", "приложения создано", "приложений создано"], "create"),
  executeCode: spec("Запустил код", "Запускаю код", "выполнить код", ["запуск кода", "запуска кода", "запусков кода"], "code"),
  giveUp: spec("Остановился", "Останавливаюсь", "продолжить работу", ["остановка", "остановки", "остановок"], "stop"),
  webFetch: spec("Открыл страницу", "Открываю страницу", "открыть страницу", ["страница", "страницы", "страниц"], "web"),
  observeUserChanges: spec("Посмотрел ваши правки", "Смотрю ваши правки", "посмотреть ваши правки", ["просмотр правок", "просмотра правок", "просмотров правок"], "edit"),
  listBlueprints: spec("Посмотрел шаблоны приложений", "Смотрю шаблоны приложений", "получить шаблоны приложений", ["просмотр шаблонов", "просмотра шаблонов", "просмотров шаблонов"], "app"),
  listConnectableResources: spec("Посмотрел, что можно подключить", "Смотрю, что можно подключить", "получить список подключений", ["просмотр подключений", "просмотра подключений", "просмотров подключений"], "link"),
  requestConnection: spec("Попросил подключить", "Прошу подключить", "попросить подключение", ["запрос подключения", "запроса подключения", "запросов подключения"], "connection"),
  codeWork: spec("Поручил агенту кода", "Поручаю агенту кода", "поручить работу агенту кода", ["поручение агенту кода", "поручения агенту кода", "поручений агенту кода"], "code"),
  codeAsk: spec("Спросил агента кода", "Спрашиваю агента кода", "спросить агента кода", ["вопрос агенту кода", "вопроса агенту кода", "вопросов агенту кода"], "code"),
};

// ---- чтения сведений Mnemos (gatekeeper-mnemos READ_TITLES и EXTRA_READ_TITLES) ----

/** Вид чтения → что посмотрел агент, и заголовок из описания наблюдения (для старых бесед). */
export const MNEMOS_INFO_DISPLAY: Record<string, { object: string; icon: StepIcon; legacyTitle: string }> = {
  document_access: { object: "кому открыт документ", icon: "access", legacyTitle: "кому открыт документ" },
  reviews: { object: "согласования", icon: "review", legacyTitle: "согласования" },
  access_requests: { object: "запросы на доступ", icon: "access", legacyTitle: "запросы на доступ" },
  departments: { object: "отделы", icon: "person", legacyTitle: "отделы" },
  invitations: { object: "приглашения", icon: "person", legacyTitle: "приглашения" },
  project_budget: { object: "лимит расходов проекта", icon: "budget", legacyTitle: "лимит проекта" },
  connections: { object: "подключения почты, календаря и репозиториев", icon: "connection", legacyTitle: "подключения" },
  work_journal: { object: "журнал работ проекта", icon: "info", legacyTitle: "журнал работ проекта" },
  spending: { object: "расходы", icon: "budget", legacyTitle: "расходы" },
  org_rules: { object: "правила организации", icon: "info", legacyTitle: "правила организации" },
  review_policy: { object: "согласование проекта", icon: "review", legacyTitle: "согласование проекта" },
  person_rights: { object: "права сотрудника", icon: "access", legacyTitle: "права сотрудника" },
  competencies: { object: "компетенции", icon: "person", legacyTitle: "компетенции" },
  acceptances: { object: "приёмку работ", icon: "review", legacyTitle: "приёмка работ" },
  template_proposals: { object: "предложения шаблонов", icon: "document", legacyTitle: "предложения шаблонов" },
  intake_questions: { object: "вопросы приёмной", icon: "info", legacyTitle: "вопросы приёмной" },
  team_budgets: { object: "командные бюджеты", icon: "budget", legacyTitle: "командные бюджеты" },
  agents: { object: "агентов", icon: "agent", legacyTitle: "агенты" },
  sources: { object: "подключённые источники", icon: "connection", legacyTitle: "подключения источников" },
};

// ---- наблюдения Mnemos (authorizeObservation в gatekeeper-mnemos) ----

export const MNEMOS_OBSERVATION_DISPLAY = {
  "mnemos.catalog": spec("Посмотрел список проектов", "Смотрю список проектов", "получить список проектов", ["просмотр списка проектов", "просмотра списка проектов", "просмотров списка проектов"], "folder"),
  "mnemos.projects": spec("Посмотрел список проектов", "Смотрю список проектов", "получить список проектов", ["просмотр списка проектов", "просмотра списка проектов", "просмотров списка проектов"], "folder"),
  "mnemos.search": spec("Искал", "Ищу", "найти", ["поиск", "поиска", "поисков"], "search"),
  "mnemos.open": spec("Открыл", "Открываю", "открыть документ", ["документ открыт", "документа открыто", "документов открыто"], "document"),
  "mnemos.browse": spec("Посмотрел папки", "Смотрю папки", "посмотреть папки", ["просмотр папок", "просмотра папок", "просмотров папок"], "folder"),
  "mnemos.publish": spec("Подготовил публикацию", "Готовлю публикацию", "подготовить публикацию", ["публикация", "публикации", "публикаций"], "publish"),
  "mnemos.prepare": spec("Подготовил действие", "Готовлю действие", "подготовить действие", ["действие подготовлено", "действия подготовлено", "действий подготовлено"], "review"),
  "mnemos.status": spec("Проверил итог действия", "Проверяю итог действия", "узнать итог действия", ["проверка итога", "проверки итога", "проверок итога"], "review"),
  "mnemos.info": spec("Посмотрел сведения Mnemos", "Смотрю сведения Mnemos", "получить сведения Mnemos", ["запрос сведений", "запроса сведений", "запросов сведений"], "info"),
  "mnemos.personal": spec("Посмотрел личные материалы", "Смотрю личные материалы", "прочитать личные материалы", ["обращение к личным материалам", "обращения к личным материалам", "обращений к личным материалам"], "document"),
  "mnemos.personal.list": spec("Посмотрел личные документы", "Смотрю личные документы", "получить личные документы", ["просмотр личных документов", "просмотра личных документов", "просмотров личных документов"], "folder"),
  "mnemos.personal.read": spec("Открыл личный документ", "Открываю личный документ", "открыть личный документ", ["личный документ открыт", "личных документа открыто", "личных документов открыто"], "document"),
  "mnemos.tracker.read": spec("Открыл трекер задач", "Открываю трекер задач", "открыть трекер задач", ["трекер открыт", "трекера открыто", "трекеров открыто"], "document"),
  "mnemos.tracker.change": spec("Изменил задачу в трекере", "Меняю задачу в трекере", "изменить задачу в трекере", ["задача изменена", "задачи изменено", "задач изменено"], "edit"),
  "mnemos.create": spec("Создал документ", "Создаю документ", "создать документ", ["документ создан", "документа создано", "документов создано"], "create"),
  "mnemos.edit": spec("Изменил документ", "Меняю документ", "изменить документ", ["документ изменён", "документа изменено", "документов изменено"], "edit"),
  "mnemos.native.open": spec("Открыл документ в редакторе", "Открываю документ в редакторе", "открыть документ в редакторе", ["документ в редакторе", "документа в редакторе", "документов в редакторе"], "document"),
  "mnemos.result": spec("Получил итог чтения", "Получаю итог чтения", "получить итог чтения", ["итог", "итога", "итогов"], "info", true),
  ...Object.fromEntries(Object.entries(MNEMOS_INFO_DISPLAY).map(([kind, info]) => [
    `mnemos.info.${kind}`,
    spec(`Посмотрел ${info.object}`, `Смотрю ${info.object}`, `посмотреть ${info.object}`, ["запрос сведений", "запроса сведений", "запросов сведений"], info.icon),
  ])),
} as Record<string, DisplaySpec>;

/** Заголовки наблюдений Mnemos → вид шага: так читаются беседы, записанные до поля activity. */
export const MNEMOS_LEGACY_TITLES: Record<string, string> = {
  "Каталог Mnemos": "mnemos.catalog",
  "Список проектов Mnemos": "mnemos.projects",
  "Поиск в Mnemos": "mnemos.search",
  "Чтение документа Mnemos": "mnemos.open",
  "Папки проекта Mnemos": "mnemos.browse",
  "Публикация Mnemos": "mnemos.publish",
  "Подготовка действия Mnemos": "mnemos.prepare",
  "Итог действия Mnemos": "mnemos.status",
  "Сведения Mnemos": "mnemos.info",
  "Личные материалы Mnemos": "mnemos.personal",
  "Новый документ Mnemos": "mnemos.create",
  "Черновик Mnemos": "mnemos.edit",
  "Открыть документ Mnemos": "mnemos.native.open",
  "Материалы Mnemos": "mnemos.result",
};

/** Методы библиотеки MNEMOS, которые агент зовёт из кода, → вид шага: подпись идущего шага до прихода наблюдений. */
export const MNEMOS_LIBRARY_METHODS: Record<string, string> = {
  listPersonalDocuments: "mnemos.personal.list", readPersonalDocument: "mnemos.personal.read",
  listProjects: "mnemos.projects", searchProject: "mnemos.search", search: "mnemos.search",
  readDocument: "mnemos.open", browseProject: "mnemos.browse", publishDraft: "mnemos.publish",
  readTracker: "mnemos.tracker.read", changeTrackerTask: "mnemos.tracker.change",
  createDraft: "mnemos.create", saveDraft: "mnemos.edit", actionStatus: "mnemos.status",
  proposeConnectProject: "mnemos.prepare", proposeCreateProject: "mnemos.prepare", proposeProjectAccess: "mnemos.prepare",
  shareDocument: "mnemos.prepare", requestReview: "mnemos.prepare", decideReview: "mnemos.prepare",
  withdrawReview: "mnemos.prepare", publishReviewed: "mnemos.prepare", decideAccessRequest: "mnemos.prepare",
  setProjectVisibility: "mnemos.prepare", invitePerson: "mnemos.prepare", revokeInvitation: "mnemos.prepare",
  createDepartment: "mnemos.prepare", deleteDepartment: "mnemos.prepare", setDepartmentMember: "mnemos.prepare",
  setProjectBudget: "mnemos.prepare", disableConnection: "mnemos.prepare", updateOrgRules: "mnemos.prepare",
  setReviewDomain: "mnemos.prepare", removeReviewDomain: "mnemos.prepare", revokePersonRight: "mnemos.prepare",
  setPersonCodeAgent: "mnemos.prepare", removePerson: "mnemos.prepare", createCompetency: "mnemos.prepare",
  setCompetencyMember: "mnemos.prepare", decideAcceptance: "mnemos.prepare", decideTemplate: "mnemos.prepare",
  decideIntake: "mnemos.prepare", decideTeamBudget: "mnemos.prepare", revokeAgent: "mnemos.prepare",
  setAgentProjectRight: "mnemos.prepare", setAgentSourceAccess: "mnemos.prepare", linkRepository: "mnemos.prepare",
  refreshRepository: "mnemos.prepare", openScreen: "mnemos.prepare",
  documentAccess: "mnemos.info.document_access", listReviews: "mnemos.info.reviews",
  listAccessRequests: "mnemos.info.access_requests", listDepartments: "mnemos.info.departments",
  listInvitations: "mnemos.info.invitations", readProjectBudget: "mnemos.info.project_budget",
  listConnections: "mnemos.info.connections", readOrgRules: "mnemos.info.org_rules",
  readReviewPolicy: "mnemos.info.review_policy", readPersonRights: "mnemos.info.person_rights",
  listCompetencies: "mnemos.info.competencies", listAcceptances: "mnemos.info.acceptances",
  listTemplateProposals: "mnemos.info.template_proposals", listIntakeQuestions: "mnemos.info.intake_questions",
  listTeamBudgets: "mnemos.info.team_budgets", listAgents: "mnemos.info.agents",
  readWorkJournal: "mnemos.info.work_journal", readSpending: "mnemos.info.spending",
};

// ---- действия Mnemos с карточкой подтверждения (ACTION_LABELS, EXTRA_LABELS и публикация) ----

export type ActionDisplay = { past: string; present: string; failed: string; icon: StepIcon };
const act = (past: string, present: string, failed: string, icon: StepIcon): ActionDisplay => ({ past, present, failed, icon });

export const MNEMOS_ACTION_DISPLAY: Record<string, ActionDisplay> = {
  publish: act("Опубликовал", "Публикую", "опубликовать", "publish"),
  share_document: act("Открыл доступ к документу", "Открываю доступ к документу", "открыть доступ к документу", "share"),
  request_review: act("Отправил на согласование", "Отправляю на согласование", "отправить на согласование", "review"),
  decide_review: act("Принял решение по согласованию", "Принимаю решение по согласованию", "принять решение по согласованию", "review"),
  withdraw_review: act("Отозвал согласование", "Отзываю согласование", "отозвать согласование", "review"),
  publish_review: act("Опубликовал согласованное", "Публикую согласованное", "опубликовать согласованное", "publish"),
  decide_access_request: act("Решил запрос на доступ", "Решаю запрос на доступ", "решить запрос на доступ", "access"),
  set_project_visibility: act("Изменил видимость проекта", "Меняю видимость проекта", "изменить видимость проекта", "access"),
  invite_person: act("Пригласил сотрудника", "Приглашаю сотрудника", "пригласить сотрудника", "person"),
  revoke_invitation: act("Отозвал приглашение", "Отзываю приглашение", "отозвать приглашение", "person"),
  create_department: act("Создал отдел", "Создаю отдел", "создать отдел", "person"),
  delete_department: act("Удалил отдел", "Удаляю отдел", "удалить отдел", "delete"),
  set_department_member: act("Изменил состав отдела", "Меняю состав отдела", "изменить состав отдела", "person"),
  set_project_budget: act("Задал лимит расходов проекта", "Задаю лимит расходов проекта", "задать лимит расходов проекта", "budget"),
  disable_connection: act("Отключил подключение", "Отключаю подключение", "отключить подключение", "connection"),
  update_org_rules: act("Изменил правила организации", "Меняю правила организации", "изменить правила организации", "info"),
  set_review_domain: act("Назначил согласующих", "Назначаю согласующих", "назначить согласующих", "review"),
  remove_review_domain: act("Убрал направление согласования", "Убираю направление согласования", "убрать направление согласования", "review"),
  revoke_person_right: act("Снял право сотрудника", "Снимаю право сотрудника", "снять право сотрудника", "access"),
  set_person_code_agent: act("Изменил доступ сотрудника к агенту кода", "Меняю доступ сотрудника к агенту кода", "изменить доступ к агенту кода", "code"),
  remove_person: act("Удалил из организации", "Удаляю из организации", "удалить из организации", "delete"),
  create_competency: act("Создал компетенцию", "Создаю компетенцию", "создать компетенцию", "person"),
  set_competency_member: act("Изменил состав компетенции", "Меняю состав компетенции", "изменить состав компетенции", "person"),
  decide_acceptance: act("Принял решение по приёмке работы", "Принимаю решение по приёмке работы", "принять решение по приёмке", "review"),
  decide_template: act("Принял решение по шаблону", "Принимаю решение по шаблону", "принять решение по шаблону", "review"),
  decide_intake: act("Разобрал вопрос приёмной", "Разбираю вопрос приёмной", "разобрать вопрос приёмной", "review"),
  decide_team_budget: act("Принял решение по командному бюджету", "Принимаю решение по командному бюджету", "принять решение по бюджету", "budget"),
  revoke_agent: act("Отозвал агента", "Отзываю агента", "отозвать агента", "agent"),
  set_agent_project_right: act("Изменил право агента на проект", "Меняю право агента на проект", "изменить право агента", "agent"),
  set_agent_source_access: act("Изменил доступ агента к почте или календарю", "Меняю доступ агента к почте или календарю", "изменить доступ агента", "agent"),
  disconnect_source: act("Отключил источник", "Отключаю источник", "отключить источник", "connection"),
  create_sync_link: act("Подключил синхронизацию с GitHub", "Подключаю синхронизацию с GitHub", "подключить синхронизацию", "connection"),
  refresh_sync_link: act("Обновил синхронизацию", "Обновляю синхронизацию", "обновить синхронизацию", "connection"),
  open_screen: act("Открыл экран", "Открываю экран", "открыть экран", "app"),
};

/** Административные предложения без actionKind: узнаются по заголовку карточки. */
export const MNEMOS_ADMIN_ACTION_DISPLAY: Record<string, ActionDisplay> = {
  "Создать проект": act("Создал проект", "Создаю проект", "создать проект", "create"),
  "Подключить проект к агенту Mnemos": act("Подключил проект к агенту", "Подключаю проект к агенту", "подключить проект к агенту", "connection"),
  "Изменить доступ сотрудника": act("Выдал доступ сотруднику", "Выдаю доступ сотруднику", "выдать доступ сотруднику", "access"),
};

/** Действие чужого ресурса (почта, календарь, MCP): глагол по виду, если он узнаваем, иначе нейтральный. */
const EXTERNAL_ACTION: ActionDisplay = act("Сделал по вашему решению", "Жду вашего решения", "сделать", "review");
const MAIL_ACTION: ActionDisplay = act("Отправил письмо", "Отправляю письмо", "отправить письмо", "mail");
const CALENDAR_ACTION: ActionDisplay = act("Назначил встречу", "Назначаю встречу", "назначить встречу", "calendar");

/** Отображение действия карточки по actionKind.tag (mnemos.<вид>) или по заголовку. */
export function actionDisplay(tag: string | undefined, title: string): ActionDisplay {
  if (tag?.startsWith("mnemos.")) {
    const known = MNEMOS_ACTION_DISPLAY[tag.slice("mnemos.".length)];
    if (known) return known;
  }
  const admin = MNEMOS_ADMIN_ACTION_DISPLAY[title];
  if (admin) return admin;
  const text = `${tag ?? ""} ${title}`.toLowerCase();
  if (/письм|mail|email|send_?message/.test(text)) return MAIL_ACTION;
  if (/встреч|календар|calendar|event/.test(text)) return CALENDAR_ACTION;
  return EXTERNAL_ACTION;
}

// ---- внешние подключения: наблюдения без реестра ----

export const EXTERNAL_DISPLAY = {
  "external.observation": spec("Получил данные", "Получаю данные", "получить данные", ["обращение к подключению", "обращения к подключениям", "обращений к подключениям"], "connection"),
  "external.mcp.tools": spec("Посмотрел инструменты", "Смотрю инструменты", "получить список инструментов", ["просмотр инструментов", "просмотра инструментов", "просмотров инструментов"], "app"),
  "external.mcp.call": spec("Вызвал инструмент", "Вызываю инструмент", "вызвать инструмент", ["вызов инструмента", "вызова инструментов", "вызовов инструментов"], "app"),
} as Record<string, DisplaySpec>;

/** Все виды шагов ленты. */
export const STEP_DISPLAY: Record<string, DisplaySpec> = {
  ...Object.fromEntries(Object.entries(AGENT_TOOL_DISPLAY).map(([name, value]) => [`tool.${name}`, value])),
  ...MNEMOS_OBSERVATION_DISPLAY,
  ...EXTERNAL_DISPLAY,
};

/** Одинаковый глагол у разных видов допустим только здесь, с причиной. */
export const SHARED_PAST_VERBS: Record<string, string> = {
  "Подключил": "setBindingHook и setGadgetBinding — одно и то же подключение ресурса, второе заменило первое",
  "Посмотрел список проектов": "каталог при старте и listProjects отдают один и тот же список проектов",
};

// ---- склонение и время ----

export function plural(count: number, forms: readonly [string, string, string]): string {
  const mod10 = count % 10, mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? forms[0]
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${count} ${word}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Имя для показа: внутренний идентификатор человеку ничего не говорит. */
function shown(name: string | undefined): string | undefined {
  const value = name?.trim();
  return value && !looksLikeId(value) ? value : undefined;
}

// ---- шаги ----

export type FoundItem = {
  name: string;
  path?: string;
  snippet?: string;
  folder?: boolean;
  /** Куда ведёт ссылка: проект и документ Mnemos. */
  link?: { project: string; document?: string; resourceTitle?: string };
};

export type StepDetail =
  | { type: "found"; items: FoundItem[]; total?: number; note?: string; query?: string; where?: string }
  | { type: "lines"; lines: string[] }
  | { type: "code"; code: string; output?: string }
  | { type: "text"; text: string }
  | { type: "none" };

export type WorkStep = {
  key: string;
  kind: string;
  label: string;
  /** Итог коротко: «8 совпадений», «12 КБ». */
  meta?: string;
  error?: string;
  scope?: string;
  detail: StepDetail;
};

/** Минимум полей сохранённого наблюдения, нужный ленте. */
export type ObservationRecord = {
  chatId: number;
  sequence: number;
  resourceTitle?: string;
  title: string;
  description: string;
  workContext?: { projectName: string; resourceName?: string };
  activity?: ObservationActivity;
};

/** Шаги одного ответа модели: вызовы инструментов и наблюдения, записанные во время их выполнения. */
export type WorkBatch = { calls: AiToolCall[]; observations: ObservationRecord[] };

export type BuildOptions = {
  /** Имена проектов беседы по идентификатору: подставляются, если имя не пришло с шагом. */
  projectNames?: ReadonlyMap<string, string>;
};

type Draft = WorkStep & {
  ref?: string;
  scopeId?: string;
  subject?: string;
  awaitsResult: boolean;
  /** Для старых бесед: итог приписывается шагу по виду. */
  wantsResource?: boolean;
};

function kindOfObservation(record: ObservationRecord): string {
  const activityKind = record.activity?.kind;
  if (activityKind && (STEP_DISPLAY[activityKind] || activityKind.startsWith("mnemos.info."))) return activityKind;
  const legacy = MNEMOS_LEGACY_TITLES[record.title];
  if (legacy === "mnemos.info") {
    const title = /^Чтение: (.+?)\.?$/.exec(record.description)?.[1];
    const found = Object.entries(MNEMOS_INFO_DISPLAY).find(([, info]) => info.legacyTitle === title);
    return found ? `mnemos.info.${found[0]}` : "mnemos.info";
  }
  if (legacy) return legacy;
  if (/: list tools$/.test(record.title)) return "external.mcp.tools";
  if (/^.+: .+$/.test(record.title) && /MCP server|`[^`]+`/.test(record.description)) return "external.mcp.call";
  return "external.observation";
}

function displayFor(kind: string): DisplaySpec {
  return STEP_DISPLAY[kind] ?? EXTERNAL_DISPLAY["external.observation"];
}

function quoted(text: string | undefined, max = 60): string {
  return text ? `«${clip(text, max)}»` : "";
}

function itemsFrom(items: ObservationActivityItem[] | undefined, resourceTitle?: string): FoundItem[] {
  return (items ?? []).map(item => ({
    name: shown(item.name) ?? "Без названия",
    ...(item.path && item.path !== item.name ? { path: item.path } : {}),
    ...(item.snippet ? { snippet: item.snippet } : {}),
    ...(item.folder ? { folder: true } : {}),
    ...(item.projectId ? { link: { project: item.projectId, ...(item.documentId ? { document: item.documentId } : {}), ...(resourceTitle ? { resourceTitle } : {}) } } : {}),
  }));
}

/** Разбор описания старых наблюдений Mnemos: проект, запрос, папка, документ. */
function legacyParams(kind: string, description: string): { scopeId?: string; subject?: string; everywhere?: boolean; missing?: boolean } {
  let m: RegExpExecArray | null;
  switch (kind) {
    case "mnemos.search":
      if ((m = /^Проект «(.+?)», запрос: «([\s\S]*)»\.?$/.exec(description))) return { scopeId: m[1], subject: m[2] };
      if ((m = /^Все доступные проекты, запрос: «([\s\S]*)»\.?$/.exec(description))) return { subject: m[1], everywhere: true };
      return {};
    case "mnemos.browse":
      if ((m = /^Проект «(.+?)», папка «([\s\S]*)»\.?$/.exec(description))) return { scopeId: m[1], subject: m[2] === "корень" ? "" : m[2] };
      return {};
    case "mnemos.open":
      if ((m = /^Проект «(.+?)», документ «(.+?)»/.exec(description))) return { scopeId: m[1], subject: m[2] };
      if ((m = /^Проект «(.+?)», запрошен документ «(.+?)»/.exec(description))) return { scopeId: m[1], subject: m[2], missing: true };
      return {};
    case "mnemos.prepare":
      if ((m = /^(.+?): проверка и описание/.exec(description))) return { subject: m[1] };
      return {};
    case "mnemos.status":
      return { subject: description };
    case "mnemos.create":
      if ((m = /«(.+)»/.exec(description))) return { subject: m[1] };
      return {};
    case "mnemos.edit":
    case "mnemos.publish":
      if ((m = /в проекте «?([^».]+)»?\.?$/.exec(description))) return { scopeId: m[1] };
      return {};
  }
  return {};
}

function scopeName(scope: string | undefined, scopeId: string | undefined, names: ReadonlyMap<string, string>): string | undefined {
  return shown(scope) ?? (scopeId ? shown(names.get(scopeId)) ?? shown(scopeId) : undefined);
}

/** Строка шага наблюдения по виду; scope и subject уже без идентификаторов. */
function observationLabel(kind: string, spec: DisplaySpec, scope: string | undefined, subject: string | undefined, record: ObservationRecord): string {
  const where = scope ? (scope === "все проекты" ? " во всех проектах" : ` в «${scope}»`) : "";
  switch (kind) {
    case "mnemos.search": return `${spec.past} ${quoted(subject) || "по проекту"}${where}`;
    case "mnemos.open": return `${spec.past} ${quoted(subject, 80) || "документ"}${where}`;
    case "mnemos.browse": return subject ? `Посмотрел папку ${quoted(subject)}${where}` : `${spec.past} проекта ${scope ? `«${scope}»` : "—"}`;
    case "mnemos.prepare": return `${spec.past}${subject ? ` «${subject}»` : ""}`;
    case "mnemos.status": return `${spec.past}${subject ? ` «${clip(subject, 80)}»` : ""}`;
    case "mnemos.create": case "mnemos.edit": case "mnemos.tracker.read":
      return `${spec.past}${subject ? ` ${quoted(subject, 80)}` : ""}${where}`;
    case "mnemos.tracker.change": return `${spec.past}${subject ? ` ${quoted(subject, 80)}` : ""}`;
    case "mnemos.publish": case "mnemos.personal.list": case "mnemos.personal.read": case "mnemos.personal":
      return `${spec.past}${where}`;
    case "external.mcp.tools": return `${spec.past} «${record.title.replace(/: list tools$/, "")}»`;
    case "external.mcp.call": {
      const [server, ...tool] = record.title.split(": ");
      return `${spec.past} «${tool.join(": ")}» в «${server}»`;
    }
    case "external.observation": return `${spec.past}${record.resourceTitle ? ` из «${record.resourceTitle}»` : ""}: ${record.title}`;
  }
  return spec.past;
}

function observationDraft(record: ObservationRecord, names: ReadonlyMap<string, string>): Draft {
  const kind = kindOfObservation(record);
  const spec = displayFor(kind);
  const activity = record.activity?.kind === kind ? record.activity : undefined;
  const legacy = activity ? {} : legacyParams(kind, record.description);
  const scopeId = activity?.scopeId ?? legacy.scopeId;
  const scope = activity?.scope ?? ("everywhere" in legacy && legacy.everywhere ? "все проекты" : undefined);
  const subject = shown(activity?.subject ?? legacy.subject) ?? (kind === "mnemos.browse" ? "" : undefined);
  const where = scopeName(scope, scopeId, names);
  const label = observationLabel(kind, spec, where, subject, record);
  const key = `obs-${record.chatId}-${record.sequence}`;
  const awaitsResult = kind === "mnemos.search" || kind === "mnemos.open" || kind === "mnemos.browse";
  let detail: StepDetail = { type: "none" };
  if (awaitsResult) detail = { type: "found", items: [], ...(kind === "mnemos.search" && subject ? { query: activity?.subject ?? legacy.subject } : {}), ...(where ? { where } : {}) };
  else if (kind.startsWith("external.")) detail = { type: "text", text: record.description };
  const draft: Draft = {
    key, kind, label, scope: where, detail, awaitsResult,
    ...(activity?.ref ? { ref: activity.ref } : {}),
    ...(scopeId ? { scopeId } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(kind === "mnemos.open" ? { wantsResource: true } : {}),
  };
  if ("missing" in legacy && legacy.missing) {
    draft.error = "Документ не найден или к нему нет доступа.";
    draft.label = `Не удалось ${spec.failed} ${quoted(subject, 80)}`.trimEnd();
    draft.awaitsResult = false;
  }
  return draft;
}

/** Итог чтения приписывается шагу: по ref, для старых бесед — первому ждущему шагу подходящего вида. */
function attachResult(record: ObservationRecord, drafts: Draft[]): void {
  const activity = record.activity?.kind === "mnemos.result" ? record.activity : undefined;
  const target = activity?.ref
    ? drafts.find(draft => draft.ref === activity.ref)
    : drafts.find(draft => draft.awaitsResult && !!draft.wantsResource === !!record.workContext?.resourceName);
  if (!target) return;
  target.awaitsResult = false;
  const projectName = record.workContext?.projectName ?? activity?.scope;
  if (!target.scope && shown(projectName)) {
    target.scope = shown(projectName);
    const spec = displayFor(target.kind);
    target.label = observationLabel(target.kind, spec, target.scope, target.subject, record);
  }
  if (target.detail.type === "found") {
    const items = activity?.items ? itemsFrom(activity.items, record.resourceTitle)
      : record.workContext?.resourceName ? [{ name: record.workContext.resourceName }] : [];
    target.detail = { ...target.detail, items, ...(activity?.total !== undefined ? { total: activity.total } : {}), ...(activity?.note ? { note: activity.note } : {}), ...(target.scope ? { where: target.scope } : {}) };
    if (target.kind === "mnemos.search" && activity?.total !== undefined) target.meta = plural(activity.total, ["совпадение", "совпадения", "совпадений"]);
    if (target.kind === "mnemos.browse" && activity?.total !== undefined) target.meta = plural(activity.total, ["запись", "записи", "записей"]);
    if (target.kind === "mnemos.open" && activity?.note) target.meta = activity.note;
  }
}

/** Что делает код: первый комментарий или вызванные методы; для идущего шага и для кода без наблюдений. */
export function describeCode(code: string): { kinds: string[]; summary?: string } {
  const kinds: string[] = [];
  for (const match of code.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    const kind = MNEMOS_LIBRARY_METHODS[match[1]];
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  const comment = /^\s*(?:\/\/|#)\s*(.+)$/m.exec(code)?.[1]?.trim();
  if (comment && /[А-Яа-яЁё]/.test(comment)) return { kinds, summary: clip(comment, 80) };
  if (kinds.length) return { kinds, summary: kinds.map(kind => lowerFirst(displayFor(kind).past)).join(", ") };
  const calls = [...new Set([...code.matchAll(/\benv\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)].map(m => `${m[1]}.${m[2]}`))];
  return { kinds, ...(calls.length ? { summary: calls.slice(0, 2).join(", ") } : {}) };
}

function lowerFirst(text: string): string { return text ? text[0].toLowerCase() + text.slice(1) : text; }

function lineRange(offset: number | undefined, limit: number | undefined): string | undefined {
  if (offset === undefined && limit === undefined) return undefined;
  const from = offset ?? 1;
  return limit !== undefined ? `строки ${from}–${from + limit - 1}` : `со строки ${from}`;
}

function host(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** Строка вызова инструмента агента. */
export function callStep(call: AiToolCall): WorkStep {
  const spec = AGENT_TOOL_DISPLAY[call.toolName];
  const key = `call-${call.toolCallId}`;
  let target: string | undefined;
  let meta: string | undefined;
  let detail: StepDetail = { type: "none" };
  switch (call.toolName) {
    case "readFile":
      target = call.input.filename; meta = lineRange(call.input.offset, call.input.limit);
      break;
    case "writeFile":
      target = call.input.filename; meta = plural(call.input.content?.split("\n").length ?? 0, ["строка", "строки", "строк"]);
      break;
    case "editFile":
      target = call.input.filename;
      detail = { type: "lines", lines: [`Было: ${clip(call.input.textToReplace ?? "", 200)}`, `Стало: ${clip(call.input.replacement ?? "", 200)}`] };
      break;
    case "describeBinding": target = shown(String(call.input.name)); break;
    case "setBindingHook": target = call.input.bindingName; break;
    case "setGadgetBinding": target = call.input.name ?? call.input.source; break;
    case "saveCapsuleAsBinding": target = call.input.bindingName; break;
    case "createGadget": target = call.input.title; break;
    case "executeCode": {
      const described = describeCode(call.input.code ?? "");
      target = described.summary;
      detail = { type: "code", code: call.input.code ?? "", ...(call.output ? { output: call.output } : {}) };
      break;
    }
    case "giveUp": detail = { type: "text", text: call.input.error }; break;
    case "webFetch":
      target = host(call.input.url);
      detail = { type: "lines", lines: [call.input.url] };
      break;
    case "listConnectableResources": target = call.input.vendorId; break;
    case "requestConnection":
      target = call.input.vendorId;
      if (call.input.reason) detail = { type: "text", text: call.input.reason };
      break;
    case "codeWork": target = call.output?.projectTitle; break;
    case "codeAsk": target = call.output?.projectTitle; break;
  }
  const shownTarget = target && !looksLikeId(target) ? target : undefined;
  const separator = call.toolName === "executeCode" ? ": " : " ";
  const quotedTarget = shownTarget && (call.toolName === "createGadget" || call.toolName === "codeWork" || call.toolName === "codeAsk") ? `«${shownTarget}»` : shownTarget;
  const label = call.error
    ? `Не удалось ${spec.failed}${shownTarget ? ` ${quotedTarget}` : ""}`
    : `${spec.past}${quotedTarget ? `${separator}${quotedTarget}` : ""}`;
  return { key, kind: `tool.${call.toolName}`, label, ...(meta ? { meta } : {}), ...(call.error ? { error: call.error } : {}), detail };
}

/**
 * Шаги хода работы. Код, через который агент зовёт подключения, отдельной строкой не показывается:
 * за него говорят наблюдения подключения («Искал …», «Открыл …»); сам код — в `code`.
 */
export function buildWorkSteps(batches: readonly WorkBatch[], options: BuildOptions = {}): { steps: WorkStep[]; code: { key: string; code: string; output?: string }[] } {
  const names = new Map(options.projectNames ?? []);
  // Имя проекта из итога чтения узнаётся и для соседних шагов с тем же проектом.
  for (const batch of batches) {
    let pending: string | undefined;
    for (const record of batch.observations) {
      const kind = kindOfObservation(record);
      const params = record.activity?.kind === kind ? { scopeId: record.activity.scopeId } : legacyParams(kind, record.description);
      if (kind === "mnemos.result") {
        const scopeId = record.activity?.scopeId ?? pending;
        const name = record.workContext?.projectName ?? record.activity?.scope;
        if (scopeId && shown(name) && !names.has(scopeId)) names.set(scopeId, name!);
      } else if (params.scopeId) pending = params.scopeId;
    }
  }
  const steps: WorkStep[] = [];
  const code: { key: string; code: string; output?: string }[] = [];
  for (const batch of batches) {
    const drafts: Draft[] = [];
    for (const record of batch.observations) {
      if (kindOfObservation(record) === "mnemos.result") attachResult(record, drafts);
      else drafts.push(observationDraft(record, names));
    }
    const observed = drafts.map(({ ref: _r, scopeId: _s, subject: _j, awaitsResult: _a, wantsResource: _w, ...step }) => step as WorkStep);
    let placed = observed.length === 0;
    for (const call of batch.calls) {
      if (call.toolName === "executeCode" && !call.error && observed.length > 0) {
        code.push({ key: `call-${call.toolCallId}`, code: call.input.code ?? "", ...(call.output ? { output: call.output } : {}) });
        if (!placed) { steps.push(...observed); placed = true; }
        continue;
      }
      steps.push(callStep(call));
    }
    if (!placed) steps.push(...observed);
  }
  return { steps, code };
}

// ---- группировка и итог ----

export type StepGroup = { key: string; kind: string; label: string; meta?: string; steps: WorkStep[]; hasError: boolean };

function times(count: number): string { return plural(count, ["раз", "раза", "раз"]); }

/** Подряд идущие однотипные успешные шаги сворачиваются в одну строку с раскрытием. */
export function groupSteps(steps: readonly WorkStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last && last.kind === step.kind && !step.error && !last.hasError && step.detail.type !== "code") last.steps.push(step);
    else groups.push({ key: step.key, kind: step.kind, label: step.label, ...(step.meta ? { meta: step.meta } : {}), steps: [step], hasError: !!step.error });
  }
  for (const group of groups) {
    if (group.steps.length < 2) continue;
    const spec = displayFor(group.kind);
    const n = group.steps.length;
    const scopes = new Set(group.steps.map(step => step.scope ?? ""));
    const scope = scopes.size === 1 ? [...scopes][0] : "";
    const where = scope ? (scope === "все проекты" ? " во всех проектах" : ` в «${scope}»`) : "";
    switch (group.kind) {
      case "mnemos.search": group.label = `${spec.past}${where} ${times(n)}`; break;
      case "mnemos.open": group.label = `${spec.past} ${plural(n, ["документ", "документа", "документов"])}${where}`; break;
      case "mnemos.browse": group.label = `${spec.past}${where} ${times(n)}`; break;
      case "tool.readFile": group.label = `${spec.past} ${plural(n, ["файл", "файла", "файлов"])}`; break;
      case "tool.writeFile": group.label = `${spec.past} ${plural(n, ["файл", "файла", "файлов"])}`; break;
      case "tool.editFile": group.label = `Внёс ${plural(n, ["правку", "правки", "правок"])}`; break;
      case "tool.webFetch": group.label = `Открыл ${plural(n, ["страницу", "страницы", "страниц"])}`; break;
      default: group.label = `${spec.past} · ${times(n)}`;
    }
    const totals = group.steps.map(step => step.detail.type === "found" ? step.detail.total : undefined);
    if (group.kind === "mnemos.search" && totals.every(total => total !== undefined)) {
      group.meta = `всего ${plural(totals.reduce((sum, total) => sum! + total!, 0)!, ["совпадение", "совпадения", "совпадений"])}`;
    } else delete group.meta;
  }
  return groups;
}

/** Итоговая строка: «Готово за 42 с · 11 поисков, 3 документа открыто, 2 запуска кода». */
export function summarizeRun(steps: readonly WorkStep[], codeRuns: number, durationMs?: number, inProgress = false): string {
  const counts = new Map<string, number>();
  for (const step of steps) counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1);
  if (codeRuns > 0) counts.set("tool.executeCode", (counts.get("tool.executeCode") ?? 0) + codeRuns);
  const parts = [...counts].map(([kind, count]) => plural(count, displayFor(kind).tally));
  const shownParts = parts.length > 4 ? [...parts.slice(0, 3), `ещё ${plural(parts.length - 3, ["вид шагов", "вида шагов", "видов шагов"])}`] : parts;
  const errors = steps.filter(step => step.error).length;
  const head = inProgress ? "Работаю" : durationMs !== undefined && durationMs >= 1000 ? `Готово за ${formatDuration(durationMs)}` : "Готово";
  return [head, [...shownParts, ...(errors ? [plural(errors, ["ошибка", "ошибки", "ошибок"])] : [])].join(", ")].filter(Boolean).join(" · ");
}

/** Подпись идущего шага: настоящее время и объект, для кода — по вызванным методам. */
export function describeLiveStep(toolName: AiToolCall["toolName"] | null, target: string | undefined, code: string | undefined): string {
  if (!toolName) return "Готовлю шаг";
  if (toolName === "executeCode") {
    const described = describeCode(code ?? "");
    if (described.kinds.length) return `${displayFor(described.kinds[0]).present}${described.kinds.length > 1 ? " и не только" : ""}`;
    return `${AGENT_TOOL_DISPLAY.executeCode.present}${described.summary ? `: ${described.summary}` : ""}`;
  }
  const shownTarget = target && !looksLikeId(target) ? target : undefined;
  return `${AGENT_TOOL_DISPLAY[toolName].present}${shownTarget ? ` ${shownTarget}` : ""}`;
}
