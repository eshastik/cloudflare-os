import { useEffect, useState } from "react";
import { Button, DropdownMenu, Tabs } from "@cloudflare/kumo";
import { Buildings, CaretDown, Check } from "@phosphor-icons/react";
import { useHost, useUi } from "./host.ts";
import { pendingCount, useMemoryData } from "./data.ts";
import DocumentsTab from "./DocumentsTab.tsx";
import ApprovalsTab from "./ApprovalsTab.tsx";
import MyWorkTab from "./MyWorkTab.tsx";
import ProjectsTab from "./ProjectsTab.tsx";
import SourcesTab from "./SourcesTab.tsx";
import AgentsTab from "./AgentsTab.tsx";
import OrganizationTab from "./OrganizationTab.tsx";

type TabId = "my-work" | "projects" | "documents" | "approvals" | "sources" | "agents" | "organization" | "more";

export default function MemoryPage({ legacy }: { legacy: HTMLElement }) {
  const ui = useUi();
  const host = useHost();
  const [selectedProject, setSelectedProject] = useState("");
  const data = useMemoryData(ui);
  const [tab, setTab] = useState<TabId>("my-work");
  const [documentsProject, setDocumentsProject] = useState("");
  useEffect(() => { let cancelled = false; void host.getSelectedProject().then(project => { if (!cancelled && project) { setSelectedProject(project); setTab("projects"); } }).catch(() => {}); return () => { cancelled = true }; }, [host]);
  useEffect(() => { legacy.hidden = tab !== "more"; }, [tab, legacy]);

  const userId = data.identity?.subject.user_id ?? "";
  const pending = pendingCount(data.reviews, userId);
  const organizationVisible = !!data.projects.length || (data.identity?.capabilities ?? []).some(c => ["principal.manage", "platform.metrics.read"].includes(c));
  useEffect(() => { if (tab === "organization" && !organizationVisible) setTab("my-work"); }, [tab, organizationVisible]);
  const tenant = data.identity?.tenant_name || "Организация";

  return (
    <div className="mx-auto flex w-full max-w-[1024px] flex-col px-10 pt-10 pb-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-kumo-default">Память</h1>
          <p className="mt-2 mb-0 max-w-[600px] text-sm text-kumo-subtle">Документы, задачи, агенты и решения вашей команды в Mnemos.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Фрейм знает только одну организацию — ту, под которой человек вошёл; список для переключения появится вместе с несколькими подключениями. */}
          <Button variant="ghost" size="sm" onClick={()=>void data.reloadProjects()}>Обновить права</Button>
          <DropdownMenu>
            <DropdownMenu.Trigger render={<Button variant="secondary" icon={Buildings} aria-label={`Организация: ${tenant}`} />}>
              <span className="flex items-center gap-1.5">{tenant}<CaretDown size={12} aria-hidden="true" /></span>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" className="min-w-[200px] rounded-lg border border-kumo-line bg-kumo-base p-1">
              <DropdownMenu.Label>Организации</DropdownMenu.Label>
              <DropdownMenu.Item icon={Check} selected>{tenant}</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-6">
        <Tabs
          variant="underline"
          value={tab}
          onValueChange={value => setTab(value as TabId)}
          tabs={[
            { value: "my-work", label: "Моя работа" },
            { value: "projects", label: "Проекты" },
            { value: "documents", label: "Документы" },
            { value: "approvals", label: <>Согласования{pending > 0 && <span className="ml-1 rounded-full bg-kumo-fill px-1.5 text-[11px] leading-4 font-medium text-kumo-subtle">{pending}</span>}</> },
            { value: "sources", label: "Источники" },
            { value: "agents", label: "Агенты" },
            ...(organizationVisible ? [{ value: "organization", label: "Организация" }] : []),
            { value: "more", label: "Ещё" },
          ]}
        />
      </div>

      <div className="mt-5">
        {tab === "my-work" && <MyWorkTab data={data} />}
        {tab === "projects" && <ProjectsTab initialProject={selectedProject} data={data} onOpenDocuments={project => { setDocumentsProject(project); setTab("documents"); }} onOpenSources={() => setTab("sources")} />}
        {tab === "documents" && <DocumentsTab data={data} initialProject={documentsProject} />}
        {tab === "approvals" && <ApprovalsTab data={data} />}
        {tab === "sources" && <SourcesTab data={data} />}
        {tab === "agents" && <AgentsTab data={data} />}
        {tab === "organization" && organizationVisible && <OrganizationTab data={data} />}
        {tab === "more" && <p className="m-0 mb-3 text-[12px] text-kumo-subtle">Прежние разделы, у которых пока нет места по вкладкам.</p>}
      </div>
    </div>
  );
}
