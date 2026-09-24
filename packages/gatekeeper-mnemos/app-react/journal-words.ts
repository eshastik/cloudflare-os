// Журнал действий словами. Модуль без React: его проверяют и тесты оболочки, и
// обычные тесты node.
//
// Перечень операций взят из сервера Mnemos (services/**: audit.Event{Action: ...}
// и AuditedTenantTx(..., "<операция>", ...)). Сервер пишет в один журнал и дела
// людей, и собственные технические шаги: попытки записи в хранилище, продление
// сессий, чтения, пересборку индекса. Человеку показываются только значимые дела;
// всё, чего нет в перечне значимых, считается технической записью.
//
// Журнал действий собирается из двух видов источников: журнал операций
// организации (GET /v1/admin/audit — туда же пишутся отделы, приглашения, права,
// видимость проектов) и журналы работ проектов (GET /v1/projects/{p}/work-journal —
// итоги принятых работ агентов и публикаций). Одно действие может оставить след в
// обоих; такие пары склеиваются в одну строку (см. mergeJournal).
import type { OperationAuditEvent } from "../src/operation-audit.ts";
import type { WorkJournalEntry } from "../src/mnemos-api.ts";

export interface JournalNames {
  /** Имя человека или агента по идентификатору; пустая строка — имя неизвестно. */
  actor(id: string): string;
  /** Название проекта; пустая строка — проект недоступен смотрящему. */
  project(id: string): string;
  /** Документ проекта: имя и признак папки; null — документ неизвестен. */
  document(project: string, node: string): { name: string; dir: boolean } | null;
  /** Название отдела; пустая строка — неизвестен. */
  unit(id: string): string;
  /** Приглашение: кого пригласили; null — неизвестно. */
  invitation(id: string): { name: string; email: string } | null;
}

export interface JournalLine {
  /** Предложение целиком: кто и что сделал. */
  text: string;
  /** Техническая запись: по умолчанию не показывается. */
  technical: boolean;
  /** Проект, к которому относится событие, если его удалось определить. */
  projectId: string;
}

// Мужские имена на -а/-я: по окончанию их легко принять за женские.
const MALE_ON_A = new Set(["никита", "илья", "фома", "лука", "кузьма", "савва", "данила", "гаврила", "миша", "паша", "лёша", "леша", "дима", "вова", "коля", "петя", "ваня", "серёжа", "сережа", "гоша", "юра", "толя", "боря", "федя", "стёпа", "степа", "лёва", "лева", "гена", "витя", "костя", "жора", "рома", "тёма", "тема", "сеня", "саша", "женя", "слава", "валя"]);

/** Женский ли род у подписи: для согласования глагола прошедшего времени. */
export function feminine(name: string): boolean {
  const first = name.trim().split(/\s+/)[0]?.toLocaleLowerCase("ru-RU") ?? "";
  if (first === "система" || first === "платформа") return true;
  if (!/[ая]$/.test(first) || MALE_ON_A.has(first)) return false;
  // «коллега» — род неизвестен, оставляем мужской.
  return first !== "коллега";
}

/** Разбор адреса ресурса: сервер пишет составной адрес JSON-массивом, иначе — строкой. */
function parts(resource: string): string[] {
  if (resource.startsWith("[")) {
    try { const out = JSON.parse(resource); if (Array.isArray(out)) return out.map(String); } catch { /* не массив — строка */ }
  }
  if (resource.startsWith("{")) {
    try {
      const out = JSON.parse(resource) as Record<string, unknown>;
      return [String(out.project_id ?? ""), String(out.node_id ?? "")];
    } catch { /* не объект — строка */ }
  }
  return [resource];
}

const CAPABILITIES: Record<string, string> = {
  "project.create": "создавать проекты",
  "principal.manage": "управлять людьми и правами",
  "platform.metrics.read": "смотреть состояние системы",
};

/** Кому виден проект после смены видимости. */
const AUDIENCE: Record<string, string> = { private: "только автор", department: "свой отдел", organization: "вся организация" };

/** Группа администраторов организации: членство в ней — назначение администратором. */
const ADMINS_GROUP = "system:organization-admins";

interface Say {
  /** Глагол прошедшего времени в роде исполнителя: основа мужского рода. */
  v(stem: string, reflexive?: boolean): string;
  p: string[];
  e: OperationAuditEvent;
  names: JournalNames;
  /** « в проекте «…»» или пусто. */
  inProject(id?: string): string;
  /** «документ «…»» / «папку «…»» / «документ». */
  doc(project?: string, node?: string): string;
  person(id: string): string;
}

/** Значимые операции: предложение без подлежащего. Ключ — точное имя операции. */
const MEANINGFUL: Record<string, (s: Say) => string> = {
  // Документы: адрес — [проект, документ].
  "node.create": s => `${s.v("создал")} ${s.doc()}${s.inProject()}`,
  "node.rename": s => `${s.v("переименовал")} ${s.doc()}${s.inProject()}`,
  "node.delete": s => `${s.v("удалил")} ${s.doc()}${s.p[0] && s.names.project(s.p[0]) ? ` из проекта «${s.names.project(s.p[0])}»` : ""}`,
  "node.move": s => `${s.v("переместил")} ${s.doc()}${s.inProject()}`,
  // Итог записи содержимого (пара к «попытке»); адрес — [проект, документ, отпечаток].
  "content.publish.observation": s => `${s.v("изменил")} ${s.doc()}${s.inProject()}`,
  "upload.complete": s => `${s.v("загрузил")} файл${s.inProject()}`,
  "inbox.enqueue": s => `${s.v("отправил")} файл во входящие на разбор`,
  "private-document.participant.set": s => `${s.v("открыл")} доступ к своему черновику${s.inProject()}: ${s.person(s.e.subject)}`,
  "private-document.participant.revoke": s => `${s.v("закрыл")} доступ к своему черновику${s.inProject()}: ${s.person(s.e.subject)}`,

  // Согласование публикаций.
  "publication.review.create": s => `${s.v("отправил")} изменения на согласование`,
  "publication.review.approve": s => `${s.v("одобрил")} изменения на согласовании`,
  "publication.review.reject": s => `${s.v("отклонил")} изменения на согласовании`,
  "publication.review.withdraw": s => `${s.v("отозвал")} изменения с согласования`,
  "publication.policy.set": s => `${s.v("изменил")} правила согласования${s.inProject(s.p[0])}`,

  // Проекты.
  "project.create": s => { const name = s.names.project(s.p[0]); return `${s.v("создал")} проект${name ? ` «${name}»` : ""}`; },
  "project.description.set": s => { const name = s.names.project(s.p[0]); return `${s.v("изменил")} описание проекта${name ? ` «${name}»` : ""}`; },
  // Сервер пишет эту запись и когда видимость применена сразу, и когда нужен ответ
  // руководителя или администратора; по записи их не различить.
  "project.visibility.request": s => { const name = s.names.project(s.p[0]); return `${s.v("изменил")} видимость проекта${name ? ` «${name}»` : ""}: ${AUDIENCE[s.p[1]] ?? "шире прежнего"}`; },
  "project.visibility.approve": s => `${s.v("одобрил")} просьбу открыть проект`,
  "project.visibility.reject": s => `${s.v("отклонил")} просьбу открыть проект`,
  "project.visibility.private": s => { const name = s.names.project(s.p[0]); return `${s.v("сделал")} проект${name ? ` «${name}»` : ""} личным: его отдел удалён`; },
  "project.sharing.settings": s => `${s.v("изменил")} правила доступа к проектам`,
  "budget.policy.set": s => { const name = s.names.project(s.p[0]); return `${s.v("изменил")} бюджет проекта${name ? ` «${name}»` : ""}`; },
  "budget.team.propose": s => `${s.v("запросил")} бюджет на команду агентов${s.inProject()}`,
  "budget.team.decide": s => `${s.v("принял")} решение по бюджету команды агентов${s.inProject()}`,
  "budget.team.result.review": s => `${s.v("проверил")} результат команды агентов${s.inProject()}`,

  // Отделы, люди, приглашения.
  "org_unit.create": s => { const name = s.names.unit(s.p[0]); return `${s.v("создал")} отдел${name ? ` «${name}»` : ""}`; },
  "org_unit.delete": s => `${s.v("удалил")} отдел${s.p[1] ? ` «${s.p[1]}»` : s.names.unit(s.p[0]) ? ` «${s.names.unit(s.p[0])}»` : ""}`,
  "org_unit.member.set": s => { const unit = s.names.unit(s.p[0]); return `${s.v("включил")} в отдел${unit ? ` «${unit}»` : ""}: ${s.person(s.p[1] || s.e.subject)}`; },
  "org_unit.member.remove": s => { const unit = s.names.unit(s.p[0]); return `${s.v("исключил")} из отдела${unit ? ` «${unit}»` : ""}: ${s.person(s.p[1] || s.e.subject)}`; },
  "org_invitation.create": s => { const who = s.names.invitation(s.p[0]); return who ? `${s.v("пригласил")} в организацию: ${who.name ? `${who.name} (${who.email})` : who.email}` : `${s.v("пригласил")} нового сотрудника`; },
  "org_invitation.revoke": s => { const who = s.names.invitation(s.p[0]); return `${s.v("отменил")} приглашение${who ? ` для ${who.name || who.email}` : ""}`; },
  "org_invitation.accept": s => `${s.v("принял")} приглашение и ${s.v("присоединил", true)} к организации`,
  "user.save": s => `${s.v("сохранил")} карточку сотрудника: ${s.person(s.e.subject)}`,
  "user.deactivate": s => `${s.v("отключил")} сотрудника: ${s.person(s.e.subject)}`,
  "user.reactivate": s => `${s.v("вернул")} доступ сотруднику: ${s.person(s.e.subject)}`,
  "principal.revoke": s => `${s.v("заблокировал")} учётную запись: ${s.person(s.e.subject)}`,
  "principal.restore": s => `${s.v("снял")} блокировку: ${s.person(s.e.subject)}`,
  "principal.member.add": s => s.p[0] === ADMINS_GROUP ? `${s.v("назначил")} администратором: ${s.person(s.e.subject)}` : `${s.v("добавил")} в группу: ${s.person(s.e.subject)}`,
  "principal.member.remove": s => s.p[0] === ADMINS_GROUP ? `${s.v("снял")} права администратора: ${s.person(s.e.subject)}` : `${s.v("убрал")} из группы: ${s.person(s.e.subject)}`,
  "principal.save": s => `${s.v("сохранил")} учётную запись: ${s.person(s.e.subject || s.e.resource)}`,
  "principal.role.create": s => `${s.v("создал")} роль`,
  "rights.grant": s => `${s.v("выдал")} ${rightWords(s)}: ${s.person(s.e.subject)}`,
  "rights.remove": s => `${s.v("снял")} ${rightWords(s)}: ${s.person(s.e.subject)}`,
  "platform.signal.owner.set": s => `${s.v("назначил")} ответственного за состояние системы: ${s.person(s.e.subject)}`,

  // Агенты.
  "agent.bind": s => `${s.v("подключил")} агента`,
  "agent.revoke": s => `${s.v("отключил")} агента`,
  "agent.authorization.deny": s => `${s.v("отказал")} агенту в подключении`,
  "agent.workshop.provision": s => `${s.v("начал")} работу с агентом беседы`,
  "agent.workshop.scope.update": s => `${s.v("изменил")} проекты агента беседы`,
  "agent.engagement.allow": s => `${s.v("разрешил")} коллегам привлекать своего агента`,
  "agent.engagement.revoke": s => `${s.v("запретил")} коллегам привлекать своего агента`,
  "agent.absence.enable": s => `${s.v("включил")} замещение агентом на время отсутствия`,
  "agent.absence.disable": s => `${s.v("выключил")} замещение агентом`,
  "agent.absence.task.create": s => `${s.v("поставил")} задачу агенту-заместителю`,

  // Обращения к коллегам и агентам: адрес — [проект, обращение].
  "collaboration.create": s => `${s.v("создал")} обращение${s.inProject()}`,
  "collaboration.comment": s => `${s.v("ответил")} в обращении${s.inProject()}`,
  "collaboration.result": s => `${s.v("сдал")} результат по обращению${s.inProject()}`,
  "collaboration.review": s => `${s.v("проверил")} результат обращения${s.inProject()}`,

  // Подключения.
  "git.connection.create": s => `${s.v("подключил")} хранилище кода`,
  "git.connection.disable": s => `${s.v("отключил")} хранилище кода`,
  "git.repository.configure": s => `${s.v("открыл")} проекту репозиторий${s.inProject(s.p[0].split("/")[0])}`,
  "git.repository.create": s => `${s.v("создал")} репозиторий${s.inProject()}`,
  // Код: адрес — [проект, подключение, репозиторий, …]; итог пишется второй записью.
  "git.push.forward": s => `${s.v("отправил")} изменения кода${s.inProject()}`,
  "git.merge_request.open": s => `${s.v("предложил")} изменения кода${s.inProject()}`,
  "git.merge_request.submit": s => `${s.v("отправил")} изменения кода на проверку${s.inProject()}`,
  "git.merge_request.decide": s => `${s.v("оценил")} изменения кода${s.inProject()}`,
  "git.merge_request.accept": s => `${s.v("одобрил")} изменения кода${s.inProject()}`,
  "git.merge_request.merge": s => `${s.v("принял")} изменения кода${s.inProject()}`,
  "git.merge_request.close": s => `${s.v("закрыл")} предложение изменений кода${s.inProject()}`,
  "git.merge_request.revert": s => `${s.v("отменил")} принятые изменения кода${s.inProject()}`,
  "mail.connection.create": s => `${s.v("подключил")} почту к проекту`,
  "mail.connection.disable": s => `${s.v("отключил")} почту проекта`,
  "mail.grant.configure": s => `${s.v("изменил")}, какие агенты читают почту проекта`,
  "mail.draft.stage": s => `${s.v("подготовил")} черновик письма`,
  "calendar.connection.create": s => `${s.v("подключил")} календарь к проекту`,
  "calendar.connection.disable": s => `${s.v("отключил")} календарь проекта`,
  "calendar.grant.configure": s => `${s.v("изменил")}, какие агенты видят календарь проекта`,
  "calendar.draft.stage": s => `${s.v("подготовил")} черновик встречи`,
  "externaldb.register": s => `${s.v("подключил")} базу данных${s.inProject()}`,
  "externaldb.remove": s => `${s.v("отключил")} базу данных${s.inProject()}`,
  "telegram.channel.create": s => `${s.v("подключил")} бота Telegram`,
  "telegram.channel.disable": s => `${s.v("отключил")} бота Telegram`,
  "telegram.budget.configure": s => `${s.v("изменил")} бюджет бота Telegram`,
  "telegram.task.accept": s => `${s.v("поставил")} задачу через Telegram`,
  "telegram.voice.accept": s => `${s.v("отправил")} голосовое сообщение через Telegram`,
  "telegram.correction.accept": s => `${s.v("уточнил")} задачу через Telegram`,
  "voice.transcript.confirm": s => `${s.v("подтвердил")} расшифровку голосового сообщения`,

  // Приём и шаблоны.
  "inbox.alert.approved": s => `${s.v("одобрил")} предупреждение при приёме файлов`,
  "inbox.alert.rejected": s => `${s.v("отклонил")} предупреждение при приёме файлов`,
  "policy.alert.review": s => `${s.v("рассмотрел")} предупреждение о правилах`,
  "work-template.version.create": s => `${s.v("сохранил")} шаблон работы`,
  "work-template.promotion.propose": s => `${s.v("предложил")} шаблон работы для общего использования`,
  "work-template.promotion.decide": s => `${s.v("принял")} решение по предложенному шаблону работы`,
  "work-template.scope.configure": s => `${s.v("изменил")}, где действуют шаблоны работы`,
};

/** Право словами: «право читать проект «…»» или полномочие. Адрес права — «проект[/узел]:класс:режим» либо имя полномочия. */
function rightWords(s: Say): string {
  const ref = s.e.resource;
  if (!ref.includes(":")) return `право ${CAPABILITIES[ref] ?? "администрирования"}`;
  const [where, , mode] = ref.split(":");
  const [project, node] = where.split("/");
  const name = s.names.project(project);
  const verb = mode === "write" ? "менять" : "читать";
  const target = node ? `${s.doc(project, node)} в проекте${name ? ` «${name}»` : ""}` : `проект${name ? ` «${name}»` : ""}`;
  return `право ${verb} ${target}`;
}

/** Чисто технические записи — называются словом только в режиме «Показывать служебные». */
function technicalWords(action: string): string {
  if (/\.read$|\.list$|search|query|fetch/.test(action)) return "чтение данных";
  if (/^(login|human\.credential|agent\.credential|agent\.authorization|agent-authorization)/.test(action)) return "вход и продление доступа";
  if (/^(projection|index|segment|project\.centroid|project\.closure|project\.signals)/.test(action)) return "обновление поискового индекса";
  if (/^(content|blob|storage|temporary|staging|upload|inbox)/.test(action)) return "работа хранилища файлов";
  if (/^(workspace-activity|ui-readiness|platform-signal|workflow-attempt)/.test(action)) return "проверка работы системы";
  return "техническая операция";
}

/** Одно событие журнала словами и признак технической записи. */
export function describeEvent(e: OperationAuditEvent, names: JournalNames): JournalLine {
  const p = parts(e.resource);
  const actor = actorWords(e, names);
  const woman = feminine(actor);
  const say: Say = {
    e, p, names,
    v: (stem, reflexive = false) => woman ? `${stem}а${reflexive ? "сь" : ""}` : `${stem}${reflexive ? "ся" : ""}`,
    inProject: (id = p[0]) => { const name = id ? names.project(id) : ""; return name ? ` в проекте «${name}»` : ""; },
    doc: (project = p[0], node = p[1]) => {
      const found = project && node ? names.document(project, node) : null;
      if (!found) return "документ";
      return `${found.dir ? "папку" : "документ"} «${found.name}»`;
    },
    person: id => names.actor(id) || "сотрудник",
  };
  const words = MEANINGFUL[e.action];
  // Пара «начато — итог»: первая запись только предваряет вторую.
  const technical = !words || e.reason === "requested";
  const projectId = projectOf(e.action, p, names);
  const behalf = e.on_behalf_of && e.on_behalf_of !== e.actor ? ` (по поручению: ${names.actor(e.on_behalf_of) || "сотрудник"})` : "";
  const text = technical ? `${actor}: ${technicalWords(e.action)}` : `${actor} ${words(say)}${behalf}`;
  return { text, technical, projectId };
}

function actorWords(e: Pick<OperationAuditEvent, "actor" | "on_behalf_of">, names: JournalNames): string {
  if (e.actor === "system:agenticos") return "Платформа агентов";
  if (e.actor.startsWith("system:")) return "Система";
  const name = names.actor(e.actor);
  if (name) return name[0].toLocaleUpperCase("ru-RU") + name.slice(1);
  return e.on_behalf_of && e.on_behalf_of !== e.actor ? "Агент" : "Коллега";
}

function projectOf(action: string, p: string[], names: JournalNames): string {
  const candidate = action === "git.repository.configure" ? p[0].split("/")[0] : action.startsWith("rights.") ? "" : p[0];
  return candidate && names.project(candidate) ? candidate : "";
}

/** Операции, которые журнал называет словами; для тестов и сверки с сервером. */
export const MEANINGFUL_ACTIONS = Object.keys(MEANINGFUL);

// ---------------------------------------------------------------------------
// Журналы работ проектов и слияние источников.

/** Первая строка итога работы, без лишней длины: подробности — в самом журнале работ. */
function gist(summary: string): string {
  const first = summary.trim().split(/\r?\n/).find(l => l.trim())?.trim() ?? "";
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

/** Запись журнала работ проекта словами. */
export function describeWorkEntry(w: WorkJournalEntry, names: JournalNames): JournalLine {
  const actor = actorWords({ actor: w.actor, on_behalf_of: w.on_behalf_of ?? "" }, names);
  const woman = feminine(actor);
  const v = (stem: string) => woman ? `${stem}а` : stem;
  const name = names.project(w.project_id);
  const inProject = name ? ` в проекте «${name}»` : "";
  const what = gist(w.summary);
  const tail = what ? `: ${what}` : "";
  const behalf = w.on_behalf_of && w.on_behalf_of !== w.actor ? ` (по поручению: ${names.actor(w.on_behalf_of) || "сотрудник"})` : "";
  let text: string;
  if (w.source === "publication") {
    const one = w.changed.length === 1 ? names.document(w.project_id, w.changed[0]) : null;
    text = `${actor} ${v("опубликовал")} ${one ? `${one.dir ? "папку" : "документ"} «${one.name}»` : "изменения документов"}${inProject}${tail}`;
  } else if (w.source === "merge_request") {
    const state = w.outcome === "accepted" ? "изменения кода приняты" : w.outcome === "awaiting_approval" ? "изменения кода ждут одобрения" : "работа возвращена на доработку";
    text = `${actor} ${v("сдал")} работу${inProject}, ${state}${tail}`;
  } else {
    text = `${actor} ${v("записал")} итог работы${inProject}${tail}`;
  }
  return { text: `${text}${behalf}`, technical: false, projectId: w.project_id };
}

/** Одна строка журнала действий: событие журнала операций, запись журнала работ или их склейка. */
export interface JournalItem {
  key: string;
  at: string;
  line: JournalLine;
  /** Все, кто упомянут в склеенных записях: по ним работает фильтр «Кто». */
  people: string[];
  /** События журнала операций, попавшие в строку (у склейки — несколько). */
  audit: OperationAuditEvent[];
  work?: WorkJournalEntry;
}

/** Окно, в котором запись журнала работ и событие журнала операций считаются одним действием.
 * Сервер пишет их одной операцией, но разными транзакциями: разница — секунды. */
export const SAME_ACTION_MS = 2 * 60 * 1000;

/** Операции кода, итог которых дублирует запись журнала работ с источником merge_request. */
const MERGE_ACTIONS = new Set(["git.merge_request.submit", "git.merge_request.decide", "git.merge_request.accept", "git.merge_request.merge", "git.merge_request.revert"]);

function time(at: string): number { const t = Date.parse(at); return Number.isNaN(t) ? 0 : t; }

/** Совпадает ли событие журнала операций с записью журнала работ (одно действие, два следа). */
function sameAction(w: WorkJournalEntry, e: OperationAuditEvent): boolean {
  if (e.reason === "requested" || Math.abs(time(e.at) - time(w.recorded_at)) > SAME_ACTION_MS) return false;
  const p = parts(e.resource);
  if (w.source === "merge_request") return MERGE_ACTIONS.has(e.action) && p[0] === w.project_id;
  if (w.source === "publication") {
    if (e.action === "publication.apply.intent") return e.resource === w.project_id;
    return e.action === "content.publish.observation" && p[0] === w.project_id && (!w.changed.length || w.changed.includes(p[1]));
  }
  return false;
}

/** Названия отделов из записей об удалении: создание уже удалённого отдела иначе осталось бы без имени. */
export function unitNamesFrom(events: OperationAuditEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) if (e.action === "org_unit.delete") { const p = parts(e.resource); if (p[0] && p[1]) out.set(p[0], p[1]); }
  return out;
}

/** Сливает источники в одну ленту: новые сверху, одно действие из разных источников — одной строкой. */
export function mergeJournal(audit: OperationAuditEvent[], work: WorkJournalEntry[], names: JournalNames): JournalItem[] {
  const absorbed = new Set<OperationAuditEvent>();
  const items: JournalItem[] = [];
  for (const w of work) {
    const twins = audit.filter(e => !absorbed.has(e) && sameAction(w, e));
    // У кода итог один на действие: берём ближайшее по времени событие, остальные остаются своими строками.
    const taken = w.source === "merge_request" && twins.length > 1
      ? [twins.reduce((a, b) => Math.abs(time(a.at) - time(w.recorded_at)) <= Math.abs(time(b.at) - time(w.recorded_at)) ? a : b)]
      : twins;
    taken.forEach(e => absorbed.add(e));
    const people = [w.actor, w.on_behalf_of ?? "", w.recorded_by, ...taken.flatMap(e => [e.actor, e.on_behalf_of])].filter(Boolean);
    items.push({ key: `work:${w.project_id}:${w.entry_id}`, at: w.recorded_at, line: describeWorkEntry(w, names), people: [...new Set(people)], audit: taken, work: w });
  }
  for (const e of audit) {
    if (absorbed.has(e)) continue;
    items.push({ key: `audit:${e.id}`, at: e.at, line: describeEvent(e, names), people: [...new Set([e.actor, e.on_behalf_of].filter(Boolean))], audit: [e] });
  }
  return items.sort((a, b) => time(b.at) - time(a.at) || (a.key < b.key ? 1 : -1));
}
