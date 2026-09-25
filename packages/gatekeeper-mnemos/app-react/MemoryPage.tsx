import { useEffect, useState } from "react";
import { useHost, useUi } from "./host.ts";
import { useMemoryData } from "./data.ts";
import DocumentsTab from "./DocumentsTab.tsx";
import MyWorkTab from "./MyWorkTab.tsx";
import ProjectsTab from "./ProjectsTab.tsx";
import ConnectionsTab from "./ConnectionsTab.tsx";
import RepositoriesPage from "./Repositories.tsx";
import AgentsTab from "./AgentsTab.tsx";
import PeopleTab from "./PeopleTab.tsx";
import IntakeTab from "./IntakeTab.tsx";
import RulesTab from "./RulesTab.tsx";
import JournalTab from "./JournalTab.tsx";
import TeamTab from "./TeamTab.tsx";
import { sections, resolveSection, type SectionId } from "./navigation.ts";
import { PageHeader } from "./ui.tsx";
import { UploadProvider } from "./UploadNotice.tsx";

/** Разделы, которые сами рисуют заголовок: в нём живые числа и действия раздела. */
const OWN_HEADER: ReadonlySet<SectionId> = new Set<SectionId>(["my-work", "projects", "team"]);
const WIDTH: Partial<Record<SectionId, string>> = { "my-work": "max-w-[768px]", team: "max-w-[928px]" };

/** Уведомление о загрузке живёт выше разделов: смена раздела его не снимает. */
export default function MemoryPage() {
  const host = useHost();
  const ui = useUi();
  const data = useMemoryData(ui);
  return <UploadProvider onFinished={() => void data.reloadProjects()} onOpenProject={project => void host.openSection("projects", project).catch(() => {})}>
    <Sections data={data} />
  </UploadProvider>;
}

function Sections({ data }: { data: ReturnType<typeof useMemoryData> }) {
  const host = useHost();
  const [section, setSection] = useState<SectionId | null | undefined>(undefined);
  // Панель приёма рядом с беседой: оболочка открывает её адресом intake в режиме panel.
  const [panelIntake, setPanelIntake] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedView, setSelectedView] = useState("");
  // Документ из адреса (ссылка из хода агента в беседе). seq отличает повторный переход по той же ссылке.
  const [linkedDocument, setLinkedDocument] = useState<{ node: string; seq: number } | null>(null);
  const [documentsProject, setDocumentsProject] = useState("");
  const [notice, setNotice] = useState("");
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    // Хост меняет раздел, проект и вкладку без перезагрузки фрейма; выбор перечитывается у хоста,
    // загруженные данные остаются. Поздний ответ на прежний сигнал не перекрывает новый.
    const read = () => {
      const current = ++generation;
      // Старый хост без вкладок в адресе отвечает отказом: тогда открывается вкладка по умолчанию.
      void Promise.all([host.getSelectedSection().catch(() => ""), host.getSelectedProject().catch(() => ""), host.getPresentationMode().catch(() => "page"), host.getSelectedView().catch(() => ""), host.getSelectedDocument().catch(() => "")]).then(([selected, project, mode, view, node]) => {
        if (cancelled || current !== generation) return;
        setSelectedProject(project); setSelectedView(view); setDocumentsProject(project); setCompact(mode === "panel");
        setLinkedDocument(node && project ? { node, seq: current } : null);
        setPanelIntake(selected === "intake" && mode === "panel");
        setSection(selected ? resolveSection(selected) : project ? "projects" : "my-work");
      });
    };
    read();
    const changed = (event: MessageEvent) => { if (event.source === window.parent && event.data?.type === "gatekeeper-location") read(); };
    window.addEventListener("message", changed);
    return () => { cancelled = true; window.removeEventListener("message", changed); };
  }, [host]);
  useEffect(() => {
    if (!compact) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); window.parent.postMessage({type:"mnemos-intake-close"}, "*"); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [compact]);
  const open = (target: SectionId, project?:string) => {
    setNotice("");
    void host.openSection(target, project).catch(() => setNotice("Не удалось открыть раздел. Повторите переход в основном меню."));
  };
  const capabilities = data.identity?.capabilities ?? [];
  const admin = capabilities.includes("principal.manage");
  const page = section && sections[section];
  // «Люди и отделы» решают сами: руководителю отдела без полномочия там доступно приглашение в свой отдел.
  const denied = (section === "rules" && !admin) || (section === "journal" && !admin && !capabilities.includes("platform.metrics.read"));
  // «Репозитории» — строка «Подключений», раскрытая в полноценную страницу со своим заголовком.
  const repositories = section === "connections" && selectedView === "repositories" && !compact;

  if (section === undefined) return <p role="status" className="m-0 p-10 text-[15px] text-kumo-subtle">Загрузка раздела…</p>;
  if (panelIntake) return <div className="flex w-full flex-col px-4 py-4"><IntakeTab data={data} compact /></div>;

  if (section === "projects" && !compact) return <>
    {notice && <p role="alert" className="m-0 px-10 pt-4 text-[14px] text-kumo-danger">{notice}</p>}
    <ProjectsTab initialProject={selectedProject} initialView={selectedView} linkedDocument={linkedDocument} data={data} onSelectProject={project => open("projects", project)} onSelectView={view => void host.selectView(view).catch(() => {})} onOpenDocuments={project => open("documents", project)} onOpenSources={() => open("connections")} />
  </>;

  return <div className={compact ? "flex w-full flex-col px-4 py-4" : `mx-auto flex w-full ${(section && WIDTH[section]) ?? "max-w-[1120px]"} flex-col px-4 py-8 sm:px-6 sm:py-12`}>
    {!compact && !repositories && !(section && OWN_HEADER.has(section)) && <PageHeader title={page ? page.title : "Раздел не найден"} subtitle={page?.description} />}
    {notice && <p role="alert" className="m-0 mb-4 text-[14px] text-kumo-danger">{notice}</p>}
    {!section && <p className="m-0 text-[15px] text-kumo-subtle">Выберите нужный раздел в основном меню.</p>}
    {denied ? <p role="status" className="m-0 text-[15px] text-kumo-subtle">{data.projectsLoading ? "Проверка доступа…" : "Этот раздел доступен администратору организации."}</p> : <>
      {section === "my-work" && <MyWorkTab data={data} />}
      {section === "projects" && <ProjectsTab initialProject={selectedProject} initialView={selectedView} linkedDocument={linkedDocument} data={data} onSelectProject={project => open("projects", project)} onSelectView={view => void host.selectView(view).catch(() => {})} onOpenDocuments={project => open("documents", project)} onOpenSources={() => open("connections")} />}
      {section === "documents" && <DocumentsTab key={documentsProject} data={data} initialProject={documentsProject} />}
      {section === "team" && <TeamTab data={data} onOpenProject={project => open("projects", project)} onInvite={() => open("people")} />}
      {section === "people" && <PeopleTab data={data} />}
      {section === "rules" && <RulesTab />}
      {section === "connections" && (repositories ? <RepositoriesPage data={data} onBack={() => open("connections")} /> : <ConnectionsTab data={data} />)}
      {section === "agents" && <AgentsTab data={data} />}
      {section === "journal" && <JournalTab data={data} />}
    </>}
  </div>;
}
