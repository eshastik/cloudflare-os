import { useMemo, useState } from "react";
import { Books, CaretRight, FileText, FolderSimple } from "@phosphor-icons/react";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import { corporateSources } from "./corporate-work-context";
import { plural } from "./components/chat/toolDisplay";
import type { OpenDocument } from "./components/chat/WorkSteps";

/**
 * Использованные материалы беседы: проекты и документы, которые агент действительно читал.
 * Показывает историю, не обещая текущего доступа: ссылка ведёт в приложение, оно проверит права.
 */
export default function CorporateWorkContext({messages, openDocument}: {messages: readonly AiChatMessage[]; openDocument?: OpenDocument}) {
  const projects = useMemo(() => corporateSources(messages), [messages]);
  const [open, setOpen] = useState(false);
  if (!projects.length) return null;
  const documents = projects.reduce((sum, project) => sum + project.documents.length, 0);
  const count = [plural(projects.length, ["проект", "проекта", "проектов"]), ...(documents ? [plural(documents, ["документ", "документа", "документов"])] : [])].join(", ");
  return (
    <section aria-label="Использованные материалы" className="mx-4 mb-2 max-w-[860px] rounded-2xl border border-kumo-line bg-kumo-overlay sm:mx-6">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
      >
        <Books size={16} className="flex-shrink-0 text-kumo-brand" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-kumo-default">
          Использованные материалы
          <span className="ml-2 font-normal text-kumo-subtle">{projects.map(project => `«${project.projectName}»`).join(", ")}</span>
        </span>
        <span className="flex-shrink-0 rounded-full bg-kumo-tint px-2 py-0.5 text-[12px] leading-4 text-kumo-subtle">{count}</span>
        <CaretRight size={12} weight="bold" className={`flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="border-t border-kumo-line px-4 pt-3 pb-3.5">
          <ul className="m-0 list-none space-y-3 p-0">
            {projects.map(project => {
              const openProject = project.projectId ? openDocument?.({ project: project.projectId, ...(project.resourceTitle ? { resourceTitle: project.resourceTitle } : {}) }) : undefined;
              return (
                <li key={project.projectName}>
                  <div className="flex items-center gap-2 text-[14px] leading-5">
                    <FolderSimple size={15} className="flex-shrink-0 text-kumo-inactive" aria-hidden="true" />
                    {openProject
                      ? <button type="button" onClick={openProject} className="cursor-pointer border-0 bg-transparent p-0 font-medium text-kumo-link hover:underline">{project.projectName}</button>
                      : <span className="font-medium text-kumo-default">{project.projectName}</span>}
                    {project.searches > 0 && <span className="text-[13px] text-kumo-inactive">{plural(project.searches, ["поиск или просмотр папок", "поиска или просмотра папок", "поисков или просмотров папок"])}</span>}
                  </div>
                  {project.documents.length > 0 && (
                    <ul className="m-0 mt-1.5 list-none space-y-1 p-0 pl-[23px]">
                      {project.documents.map(document => {
                        const openDoc = project.projectId && document.documentId ? openDocument?.({ project: project.projectId, document: document.documentId, ...(project.resourceTitle ? { resourceTitle: project.resourceTitle } : {}) }) : undefined;
                        return (
                          <li key={document.name} className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]">
                            <FileText size={14} className="flex-shrink-0 text-kumo-inactive" aria-hidden="true" />
                            {openDoc
                              ? <button type="button" onClick={openDoc} className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-kumo-link hover:underline">{document.name}</button>
                              : <span className="min-w-0 truncate text-kumo-default">{document.name}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-3 text-[12px] leading-4 text-kumo-inactive">По истории этой беседы. Доступ проверяется при каждом открытии; этот список прав не выдаёт.</p>
        </div>
      )}
    </section>
  );
}
