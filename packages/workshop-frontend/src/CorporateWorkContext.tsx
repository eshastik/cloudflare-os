import { useMemo, useState } from "react";
import { Books, CaretRight, FileText, FolderSimple } from "@phosphor-icons/react";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import { corporateSources, sourceTurnCount } from "./corporate-work-context";
import { plural } from "./components/chat/toolDisplay";
import type { OpenDocument } from "./components/chat/WorkSteps";

/**
 * Материалы всей беседы: проекты и документы, которые агент действительно читал.
 * Итог в конце потока сообщений (не полоса над ним): прокручивается вместе с историей.
 * Если материалы есть только в одном ходе, итог не показывается: список источников этого хода
 * (WorkSteps) уже показывает то же самое.
 * Показывает историю, не обещая текущего доступа: ссылка ведёт в приложение, оно проверит права.
 */
export default function CorporateWorkContext({messages, openDocument}: {messages: readonly AiChatMessage[]; openDocument?: OpenDocument}) {
  const projects = useMemo(() => corporateSources(messages), [messages]);
  const turns = useMemo(() => sourceTurnCount(messages), [messages]);
  const [open, setOpen] = useState(false);
  if (!projects.length || turns < 2) return null;
  const documents = projects.reduce((sum, project) => sum + project.documents.length, 0);
  const count = [plural(projects.length, ["проект", "проекта", "проектов"]), ...(documents ? [plural(documents, ["документ", "документа", "документов"])] : [])].join(", ");
  return (
    <section data-testid="corporate-work-context" aria-label="Материалы беседы" className="mt-8 max-w-[640px] border-t border-kumo-line pt-3">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-[14px] leading-5 text-kumo-subtle hover:text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
      >
        <Books size={15} className="flex-shrink-0 text-kumo-brand" aria-hidden="true" />
        <span className="flex-shrink-0 font-medium text-kumo-default">Материалы беседы</span>
        <span className="flex-shrink-0">{count}</span>
        <span className="min-w-0 truncate text-kumo-inactive">{projects.map(project => `«${project.projectName}»`).join(", ")}</span>
        <CaretRight size={12} weight="bold" className={`flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="pt-2 pb-1 pl-[29px] pr-1.5">
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
          <p className="m-0 mt-3 text-[12px] leading-4 text-kumo-inactive">Собрано по истории беседы. Доступ проверяется при каждом открытии; этот список прав не выдаёт.</p>
        </div>
      )}
    </section>
  );
}
