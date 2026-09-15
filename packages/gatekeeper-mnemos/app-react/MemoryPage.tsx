import { useEffect, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { useHost, useUi } from "./host.ts";
import { useMemoryData } from "./data.ts";
import DocumentsTab from "./DocumentsTab.tsx";
import ApprovalsTab from "./ApprovalsTab.tsx";
import MyWorkTab from "./MyWorkTab.tsx";
import ProjectsTab from "./ProjectsTab.tsx";
import SourcesTab from "./SourcesTab.tsx";
import AgentsTab from "./AgentsTab.tsx";
import PeopleTab from "./PeopleTab.tsx";
import IntakeTab from "./IntakeTab.tsx";
import OrganizationTab from "./OrganizationTab.tsx";
import { sections, resolveSection, type SectionId } from "./navigation.ts";
import { LegacyPanel, LegacySwitch, useLegacySection } from "./legacy.tsx";
import SectionTools from "./SectionTools.tsx";

export default function MemoryPage({ legacy }: { legacy: HTMLElement }) {
  const ui = useUi();
  const host = useHost();
  const data = useMemoryData(ui);
  const tools = useLegacySection();
  const [section, setSection] = useState<SectionId | null | undefined>(undefined);
  const [selectedProject, setSelectedProject] = useState("");
  const [documentsProject, setDocumentsProject] = useState("");
  const [notice, setNotice] = useState("");
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let cancelled = false;
    legacy.hidden = true;
    void Promise.all([host.getSelectedSection().catch(() => ""), host.getSelectedProject().catch(() => ""), host.getPresentationMode().catch(() => "page")]).then(([selected, project, mode]) => {
      if (cancelled) return;
      setSelectedProject(project); setDocumentsProject(project); setCompact(mode === "panel");
      setSection(selected ? resolveSection(selected) : project ? "projects" : "my-work");
    });
    return () => { cancelled = true; };
  }, [host, legacy]);
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
  const managePeople = capabilities.includes("principal.manage");
  const organizationVisible = managePeople || capabilities.includes("platform.metrics.read");
  const page = section && sections[section];
  const denied = section === "people" && !managePeople || section === "organization" && !organizationVisible;

  if (section === undefined) return <p role="status" className="p-8">Загрузка раздела…</p>;

  return <div className={compact?"flex w-full flex-col px-4 py-4":"mx-auto flex w-full max-w-[1120px] flex-col px-4 py-6 sm:px-8 sm:py-8"}>
    {!compact && <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="m-0 mb-1 text-xs text-kumo-subtle">{data.identity?.tenant_name || "Mnemos"}</p>
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-kumo-default">{page ? page.title : "Раздел не найден"}</h1>
        {page && section!=="people" && <p className="mt-2 mb-0 max-w-[650px] text-sm text-kumo-subtle">{page.description}</p>}
      </div>
      {section!=="intake"&&section!=="people"&&<Button variant="ghost" size="sm" onClick={() => void data.reloadProjects()}>Обновить</Button>}
    </header>}
    {notice && <p role="alert">{notice}</p>}
    {!section && <p>Выберите нужный раздел в основном меню.</p>}
    {denied ? <p role="status">{data.projectsLoading ? "Проверка доступа…" : "Этот раздел недоступен с вашими текущими полномочиями."}</p> : <LegacySwitch state={tools}>
      {section === "my-work" && <MyWorkTab data={data} />}
      {section === "projects" && <ProjectsTab initialProject={selectedProject} data={data} onSelectProject={project => open("projects", project)} onOpenDocuments={project => open("documents", project)} onOpenSources={() => open("sources")} />}
      {section === "documents" && <DocumentsTab data={data} initialProject={documentsProject} />}
      {section === "approvals" && <ApprovalsTab data={data} />}
      {section === "sources" && <SourcesTab data={data} />}
      {section === "agents" && <AgentsTab data={data} />}
      {section === "people" && <PeopleTab data={data} />}
      {section === "intake" && <IntakeTab data={data} compact={compact} />}
      {section === "organization" && <OrganizationTab data={data} />}
      {section === "templates" && <LegacyPanel section={{kind:"workTemplates"}} title="Рабочие шаблоны" onClose={() => open("my-work")} />}
      {!compact && section && <SectionTools section={section} onOpen={tools.open} />}
    </LegacySwitch>}
  </div>;
}
