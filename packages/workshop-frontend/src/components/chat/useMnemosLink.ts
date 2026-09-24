import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useGatekeeperApps } from "../../useGatekeeperApps";
import type { OpenDocument } from "./WorkSteps";

// Ссылка из хода работы ведёт в проект приложения Mnemos; документ передаётся в адресе, приложение
// само проверяет доступ. Приложение находят по названию ресурса, иначе — единственное с разделом «Проекты».
export function useMnemosLink(): OpenDocument {
  const apps = useGatekeeperApps();
  const navigate = useNavigate();
  return useCallback((link) => {
    const withProjects = apps.filter(app => app.sections?.some(section => section.id === "projects"));
    const app = withProjects.find(item => item.title === link.resourceTitle) ?? (withProjects.length === 1 ? withProjects[0] : undefined);
    if (!app) return undefined;
    return () => {
      void navigate({
        to: "/gatekeepers/$appId",
        params: { appId: app.id },
        search: { section: "projects", project: link.project, ...(link.document ? { document: link.document } : {}), ...(app.accountId !== undefined ? { account: app.accountId } : {}) },
      });
    };
  }, [apps, navigate]);
}
