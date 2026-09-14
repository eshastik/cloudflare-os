import { useState, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo";
import type { CorporateOrigin } from "../src/corporate-import.ts";
import { useUi } from "./host.ts";
import { projectName, useLoad, type MemoryData } from "./data.ts";
import { LegacySwitch, useLegacySection, type LegacySection } from "./legacy.tsx";
import { Block, Notice, Row, RowList, RowText, Select, StatusBadge } from "./ui.tsx";

interface SourceRow {
  key: string;
  title: string;
  /** Аккаунт и область: папка, календарь, путь, схема. */
  scope: string;
  project: string;
  actions: string;
  /** Последняя успешная загрузка, если сервер её сообщает. */
  loaded: string;
  error: string;
  /** Только у импорта копий: происхождение и надпись о неизменяемости. */
  copies: boolean;
}

const NO_LOAD_TIME = "успешных загрузок пока не зарегистрировано";
const loadedAt = (a: {last_success_at?: string}) => a.last_success_at ? timeOf(a.last_success_at) : NO_LOAD_TIME;
const loadError = (a: {last_error_at?: string}) => a.last_error_at ? `Последняя попытка чтения не удалась (${timeOf(a.last_error_at)}). Проверьте подключение.` : "";

function timeOf(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(at).toLocaleString("ru-RU");
}

export default function SourcesTab({ data }: { data: MemoryData }) {
  const ui = useUi();
  const legacy = useLegacySection();
  const imap = useLoad(() => ui.listImapAccounts(), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const mail = useLoad(() => ui.listMailConnections(""), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const caldav = useLoad(() => ui.listCalDAVAccounts(), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const calendars = useLoad(() => ui.listCalendarConnections(""), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const webdav = useLoad(() => ui.listWebDAVAccounts(), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const git = useLoad(() => ui.listGitConnections(""), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const databases = useLoad(() => ui.listVisibleDatabaseConnections(), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const telegram = useLoad(() => ui.listTelegram(), "не удалось загрузить подключения; проверьте их настройку и права доступа", [ui]);
  const project = (id: string) => projectName(data.projects, id);

  const mailRows: SourceRow[] = [
    ...(imap.value?.accounts ?? []).map(a => ({ key: `imap/${a.id}`, title: `Почта · ${imap.value?.servers.find(s => s.id === a.server)?.title ?? a.server}`, scope: `${a.username} · папка ${a.mailbox}`, project: "личный аккаунт, проект назначается подключением ниже", actions: `чтение агентом · наружу: отправка письма${a.send_from ? ` от ${a.send_from}` : ""} только после согласования черновика`, loaded: loadedAt(a), error: loadError(a) || (a.enabled ? "" : "аккаунт отключён"), copies: false })),
    ...(mail.value?.connections ?? []).map(c => ({ key: `mail/${c.connection_id}`, title: `Почта · ${c.provider}`, scope: `подключение ${c.connection_id}`, project: project(c.project_id), actions: "чтение агентом · наружу: отправка письма только после согласования черновика", loaded: loadedAt(c), error: loadError(c) || (c.enabled ? "" : "подключение отключено"), copies: false })),
  ];
  const calendarRows: SourceRow[] = [
    ...(caldav.value?.accounts ?? []).map(a => ({ key: `caldav/${a.id}`, title: `Календарь · ${caldav.value?.servers.find(s => s.id === a.server)?.title ?? a.server} (CalDAV)`, scope: `${a.username} · ${a.calendars.map(c => c.title).join(", ") || "календари не выбраны"}`, project: "личный аккаунт, проект назначается подключением ниже", actions: "чтение окна событий · наружу: встреча только после согласования черновика", loaded: loadedAt(a), error: loadError(a) || (a.enabled ? "" : "аккаунт отключён"), copies: false })),
    ...(calendars.value?.connections ?? []).map(c => ({ key: `cal/${c.connection_id}`, title: `Календарь · ${c.provider}`, scope: `календарь ${c.calendar_id}`, project: project(c.project_id), actions: "чтение окна событий · наружу: встреча только после согласования черновика", loaded: loadedAt(c), error: loadError(c) || (c.enabled ? "" : "подключение отключено"), copies: false })),
  ];
  const driveRows: SourceRow[] = (webdav.value?.accounts ?? []).map(a => ({ key: `dav/${a.id}`, title: `Диск · ${webdav.value?.servers.find(s => s.id === a.server)?.title ?? a.server} (WebDAV)`, scope: `${a.username} · выбранные файлы`, project: "проект выбирается при импорте файла", actions: "импорт копий · наружу ничего не пишется", loaded: loadedAt(a), error: loadError(a) || (a.enabled ? "" : "аккаунт отключён"), copies: true }));
  const gitRows: SourceRow[] = (git.value?.connections ?? []).map(c => ({ key: `git/${c.connection_id}`, title: `${c.name} · ${c.provider}`, scope: `${c.account_login} · ${c.api_base}`, project: "репозитории привязываются к проекту в настройке", actions: "чтение файлов и коммитов · наружу: push через подключённого агента только после согласования", loaded: loadedAt(c), error: loadError(c) || (c.enabled ? "" : "подключение отключено"), copies: false }));
  const databaseRows: SourceRow[] = (databases.value?.databases ?? []).map(d => ({ key: `db/${d.db_id}`, title: `${d.name} · ${d.driver}`, scope: d.configured ? "схема прочитана" : "схема ещё не прочитана", project: project(d.project_id), actions: "запросы агента только на чтение", loaded: d.last_sweep_at ? `последняя проверка схемы ${timeOf(d.last_sweep_at)}` : NO_LOAD_TIME, error: d.unreachable_since ? `база недоступна с ${timeOf(d.unreachable_since)}` : "", copies: false }));
  const telegramRows: SourceRow[] = (telegram.value?.connections ?? []).map(c => ({ key: `tg/${c.bot}`, title: `Telegram · @${c.username}`, scope: `бот ${c.bot} · агент ${c.binding}`, project: "проект задаётся задачей агента", actions: "задачи агенту через бот · наружу: ответы в чат от имени того же агента, с журналом", loaded: NO_LOAD_TIME, error: c.disconnected ? "бот отключён" : c.channel_registered ? "" : c.ready ? "требуется подтверждение в чате" : "бот недоступен", copies: false }));

  const groups: { title: string; rows: SourceRow[]; error: string; loading: boolean; section: LegacySection; sectionTitle: string; extra?: { section: LegacySection; title: string } }[] = [
    { title: "Почта", rows: mailRows, error: [imap.error && `аккаунты: ${imap.error}`, mail.error && `подключения: ${mail.error}`].filter(Boolean).join("; "), loading: imap.loading || mail.loading, section: { kind: "imap" }, sectionTitle: "Аккаунты почты", extra: { section: { kind: "mail" }, title: "Доступ к почте" } },
    { title: "Календарь", rows: calendarRows, error: [caldav.error && `аккаунты: ${caldav.error}`, calendars.error && `подключения: ${calendars.error}`].filter(Boolean).join("; "), loading: caldav.loading || calendars.loading, section: { kind: "caldav" }, sectionTitle: "Аккаунты календарей", extra: { section: { kind: "calendar" }, title: "Доступ к календарю" } },
    { title: "Диск", rows: driveRows, error: webdav.error, loading: webdav.loading, section: { kind: "webdav" }, sectionTitle: "Аккаунты WebDAV" },
    { title: "Git", rows: gitRows, error: git.error, loading: git.loading, section: { kind: "git" }, sectionTitle: "Git-подключения" },
    { title: "Базы данных", rows: databaseRows, error: databases.error, loading: databases.loading, section: { kind: "databases" }, sectionTitle: "Подключения БД" },
    { title: "Telegram", rows: telegramRows, error: telegram.error, loading: telegram.loading, section: { kind: "telegram" }, sectionTitle: "Telegram" },
  ];

  return (
    <LegacySwitch state={legacy}>
      <p className="mt-0 mb-4 text-[12px] text-kumo-subtle">Откуда в память приходят письма, события, файлы и код, и что разрешено делать наружу. Настройка каждого источника — кнопкой справа.</p>
      {groups.map(group => (
        <Block key={group.title} title={group.title} count={group.rows.length}
          actions={<>
            {group.extra && <Button variant="ghost" size="sm" onClick={() => legacy.open(group.extra!.section, group.extra!.title)}>{group.extra.title}</Button>}
            <Button variant="secondary" size="sm" onClick={() => legacy.open(group.section, group.sectionTitle)}>Настроить</Button>
          </>}>
          {group.error && <div className="mb-2"><Notice tone="danger">{group.title}: {group.error}.</Notice></div>}
          {group.loading && !group.error && <Notice>Загрузка…</Notice>}
          {!group.loading && !group.error && group.rows.length === 0 && <Notice>Подключений нет.</Notice>}
          {group.rows.length > 0 && (
            <RowList>
              {group.rows.map(row => (
                <Row key={row.key} className="items-start">
                  <RowText title={row.title} note={<>
                    {row.scope} · проект: {row.project}
                    <br />Доступно: {row.actions}
                    <br />{row.error ? <span className="text-kumo-danger">Ошибка доступа: {row.error}</span> : <>Последняя загрузка: {row.loaded}</>}
                    {row.copies && <><br />Импорт копий: внешний источник не изменяется, правки живут в рабочей копии в Mnemos, повторный импорт создаст новую версию копии.</>}
                  </>} />
                  <StatusBadge tone={row.error ? "danger" : "success"}>{row.error ? "Ошибка доступа" : "Подключено"}</StatusBadge>
                  {row.error && <Button variant="secondary" size="sm" onClick={() => legacy.open(group.section, group.sectionTitle)}>Переподключить</Button>}
                </Row>
              ))}
            </RowList>
          )}
        </Block>
      ))}
      <OriginBlock data={data} />
    </LegacySwitch>
  );
}

/** Происхождение импортированной копии: списка копий у сервера нет, поэтому копия выбирается документом. */
function OriginBlock({ data }: { data: MemoryData }) {
  const ui = useUi();
  const [projectId, setProjectId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [result, setResult] = useState<{ origin: CorporateOrigin | null; error: string; busy: boolean } | null>(null);
  const project = data.projects.find(p => p.id === projectId);
  const documents = project ? [...project.privateDocs].map(([id, doc]) => ({ id, name: doc.name })) : [];

  async function show() {
    setResult({ origin: null, error: "", busy: true });
    try {
      const state = await ui.draftState(projectId);
      const origin = await ui.readCorporateOrigin(projectId, nodeId, state.personal_head);
      setResult({ origin, error: "", busy: false });
    } catch {
      setResult({ origin: null, error: "У документа нет записи о происхождении, или сервер отказал в чтении.", busy: false });
    }
  }

  let outcome: ReactNode = null;
  if (result?.busy) outcome = <Notice>Читаем…</Notice>;
  else if (result?.error) outcome = <Notice tone="danger">{result.error}</Notice>;
  else if (result?.origin) outcome = (
    <Notice>
      Оригинал: {result.origin.provider} · {result.origin.entity_kind} {result.origin.entity_id} (узел источника {result.origin.source_node_id}) · рабочая копия: «{documents.find(d => d.id === nodeId)?.name ?? nodeId}» в проекте «{project?.name}» · внешний источник не изменяется.
    </Notice>
  );

  return (
    <Block title="Импортированные копии" count={undefined}>
      <p className="mt-0 mb-2 text-[12px] text-kumo-subtle">Копии из Jira, Bitrix24 и диска живут в Mnemos; внешний источник не изменяется. Для переноса используйте разделы Jira и Bitrix24 ниже. Происхождение конкретной копии:</p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select aria-label="Проект копии" value={projectId} onChange={e => { setProjectId(e.target.value); setNodeId(""); setResult(null); }}>
          <option value="">Проект…</option>
          {data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select aria-label="Документ копии" value={nodeId} onChange={e => { setNodeId(e.target.value); setResult(null); }} disabled={!projectId}>
          <option value="">Документ личной версии…</option>
          {documents.map(d => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}
        </Select>
        <Button variant="secondary" size="sm" disabled={!projectId || !nodeId || !!result?.busy} onClick={() => void show()}>Показать происхождение</Button>
      </div>
      {outcome}
    </Block>
  );
}
