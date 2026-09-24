import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ActionCardOpen } from "@gadgets/workshop-shared/gatekeeper";
import { useGatekeeperApps } from "../../useGatekeeperApps";

// Кнопка карточки-перехода ведёт в приложение ресурса, который предложил действие: его находят
// по названию ресурса в действии, а если такого нет — по единственному приложению с нужным разделом.
export function useActionOpen(): (open: ActionCardOpen, resourceTitle: string) => (() => void) | undefined {
  const apps = useGatekeeperApps();
  const navigate = useNavigate();
  return useCallback((open, resourceTitle) => {
    const withSection = apps.filter(app => app.sections?.some(section => section.id === open.section));
    const app = withSection.find(item => item.title === resourceTitle) ?? (withSection.length === 1 ? withSection[0] : undefined);
    if (!app) return undefined;
    return () => {
      void navigate({
        to: "/gatekeepers/$appId",
        params: { appId: app.id },
        search: { section: open.section, ...(open.project ? { project: open.project } : {}), ...(app.accountId !== undefined ? { account: app.accountId } : {}) },
      });
    };
  }, [apps, navigate]);
}
