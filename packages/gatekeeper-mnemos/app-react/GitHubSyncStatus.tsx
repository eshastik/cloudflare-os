import { useEffect } from "react";
import { GithubLogo } from "@phosphor-icons/react";
import { useUi } from "./host.ts";
import { useLoad } from "./data.ts";
import { linkState } from "./GitHubRepositories.tsx";

/** Страница проекта, связанного с GitHub: откуда файлы и как идёт загрузка. Пока идёт загрузка, состояние
 * перечитывается само — после «Создать проект» человек видит ход первой загрузки здесь же. */
export default function GitHubSyncStatus({ projectId }: { projectId: string }) {
  const ui = useUi();
  const links = useLoad(async () => (await ui.listProjectGitSync(projectId)).links, "", [ui, projectId]);
  const active = (links.value ?? []).filter(l => l.state !== "disabled");
  const busy = active.some(l => l.state === "pending" || l.state === "syncing");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void links.reload(), 4000);
    return () => clearInterval(timer);
  }, [busy, links.reload]);
  if (!active.length) return null;
  return <div aria-label="Синхронизация с GitHub" className="mb-5 grid gap-1.5">
    {active.map(l => {
      const state = linkState(l);
      return <p key={l.link_id} role="status" data-project-sync="" className={`m-0 flex items-center gap-2 text-[13px] ${state.tone === "danger" ? "text-kumo-danger" : "text-kumo-subtle"}`}>
        <GithubLogo size={15} aria-hidden="true" className="shrink-0" />
        <span>Из GitHub: <span className="text-kumo-default">{l.repository_name}</span>{l.folder ? ` в папку «${l.folder}»` : ""} — {state.text}</span>
        {state.tone === "busy" && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-kumo-warning motion-reduce:animate-none" />}
      </p>;
    })}
  </div>;
}
