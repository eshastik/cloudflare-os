import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useGatekeeperApps } from "../../useGatekeeperApps";
import type { GatekeeperAppInfo } from "@gadgets/workshop-shared/api";
import type { AppTarget } from "../../mnemosAppInChat";
import type { OpenDocument } from "./WorkSteps";

/** Открыть приложение Mnemos в панели текущей беседы: true — открыто, false — узел не приложение. */
export type OpenAppInChat = (target: AppTarget) => Promise<boolean>;

type ProjectsNavigation = (to: { appId: string; search: Record<string, string | number> }) => void;

/**
 * Ссылка из беседы на документ Mnemos. Приложение (гаджет) открывается в панели этой же беседы; остальные
 * документы — в проекте приложения Mnemos, как раньше: документ передаётся в адресе, приложение само проверяет
 * доступ. Приложение Mnemos находят по названию ресурса, иначе — единственное с разделом «Проекты».
 */
export function mnemosLinkOpener({ apps, navigate, openInChat, onError }: {
  apps: readonly Pick<GatekeeperAppInfo, "id" | "title" | "sections" | "accountId">[];
  navigate: ProjectsNavigation;
  openInChat?: OpenAppInChat;
  onError?: (message: string) => void;
}): OpenDocument {
  return (link) => {
    const withProjects = apps.filter(app => app.sections?.some(section => section.id === "projects"));
    const app = withProjects.find(item => item.title === link.resourceTitle) ?? (withProjects.length === 1 ? withProjects[0] : undefined);
    const toProjects = app ? () => navigate({
      appId: app.id,
      search: { section: "projects", project: link.project, ...(link.document ? { document: link.document } : {}), ...(app.accountId !== undefined ? { account: app.accountId } : {}) },
    }) : undefined;
    const accountId = link.accountId ?? app?.accountId;
    const document = link.document;
    if (openInChat && document && accountId !== undefined) {
      return () => {
        void openInChat({ accountId, scope: link.project, resource: document, ...(link.title ? { title: link.title } : {}) }).then(
          opened => {
            if (opened) return;
            if (toProjects) toProjects();
            else onError?.("Документ не открылся: приложение Mnemos не подключено.");
          },
          (error: unknown) => {
            const reason = error instanceof Error && /[А-Яа-яЁё]/.test(error.message) ? error.message.replace(/\.$/, "") : "Mnemos не ответил";
            onError?.(`Не удалось открыть: ${reason}. Повторите попытку.`);
          });
      };
    }
    return toProjects;
  };
}

export function useMnemosLink(openInChat?: OpenAppInChat, onError?: (message: string) => void): OpenDocument {
  const apps = useGatekeeperApps();
  const navigate = useNavigate();
  return useCallback((link) => mnemosLinkOpener({
    apps,
    navigate: ({ appId, search }) => { void navigate({ to: "/gatekeepers/$appId", params: { appId }, search }); },
    openInChat,
    onError,
  })(link), [apps, navigate, openInChat, onError]);
}
