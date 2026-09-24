import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { useHost, useUi } from "./host.ts";
import { useMemoryData } from "./data.ts";
import DocumentsTab from "./DocumentsTab.tsx";
import MyWorkTab from "./MyWorkTab.tsx";
import ProjectsTab from "./ProjectsTab.tsx";
import ConnectionsTab from "./ConnectionsTab.tsx";
import AgentsTab from "./AgentsTab.tsx";
import PeopleTab from "./PeopleTab.tsx";
import IntakeTab from "./IntakeTab.tsx";
import RulesTab from "./RulesTab.tsx";
import JournalTab from "./JournalTab.tsx";
import TeamTab from "./TeamTab.tsx";
import { sections, resolveSection, type SectionId } from "./navigation.ts";

export default function MemoryPage() {
  const ui = useUi();
  const host = useHost();
  const data = useMemoryData(ui);
  const [section, setSection] = useState<SectionId | null | undefined>(undefined);
  // Панель приёма рядом с беседой: оболочка открывает её адресом intake в режиме panel.
  const [panelIntake, setPanelIntake] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedView, setSelectedView] = useState("");
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
      void Promise.all([host.getSelectedSection().catch(() => ""), host.getSelectedProject().catch(() => ""), host.getPresentationMode().catch(() => "page"), host.getSelectedView().catch(() => "")]).then(([selected, project, mode, view]) => {
        if (cancelled || current !== generation) return;
        setSelectedProject(project); setSelectedView(view); setDocumentsProject(project); setCompact(mode === "panel");
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

  if (section === undefined) return <p role="status" className="p-8">Загрузка раздела…</p>;
  if (panelIntake) return <div className="flex w-full flex-col px-4 py-4"><IntakeTab data={data} compact /></div>;

  return <div className={compact?"flex w-full flex-col px-4 py-4":"mx-auto flex w-full max-w-[1120px] flex-col px-4 py-6 sm:px-8 sm:py-8"}>
    {!compact && <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="m-0 mb-1 text-xs text-kumo-subtle">{data.identity?.tenant_name || "Mnemos"}</p>
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-kumo-default">{page ? page.title : "Раздел не найден"}</h1>
        {page && <p className="mt-2 mb-0 max-w-[650px] text-sm text-kumo-subtle">{page.description}</p>}
      </div>
      {section!=="people"&&section!=="rules"&&<Button variant="ghost" size="sm" onClick={() => void data.reloadProjects()}>Обновить</Button>}
    </header>}
    {notice && <p role="alert">{notice}</p>}
    {!section && <p>Выберите нужный раздел в основном меню.</p>}
    {denied ? <p role="status">{data.projectsLoading ? "Проверка доступа…" : "Этот раздел доступен администратору организации."}</p> : <>
      {section === "my-work" && <MyWorkTab data={data} />}
      {section === "projects" && <ProjectsTab initialProject={selectedProject} initialView={selectedView} data={data} onSelectProject={project => open("projects", project)} onSelectView={view => void host.selectView(view).catch(() => {})} onOpenDocuments={project => open("documents", project)} onOpenSources={() => open("connections")} />}
      {section === "documents" && <DocumentsTab key={documentsProject} data={data} initialProject={documentsProject} />}
      {section === "team" && <TeamTab data={data} onOpenProject={project => open("projects", project)} />}
      {section === "people" && <PeopleTab data={data} />}
      {section === "rules" && <RulesTab />}
      {section === "connections" && <ConnectionsTab data={data} />}
      {section === "agents" && <AgentsTab data={data} />}
      {section === "journal" && <JournalTab data={data} />}
    </>}
  </div>;
}
