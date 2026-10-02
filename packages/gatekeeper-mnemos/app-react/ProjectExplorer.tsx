import { useEffect, useRef, useState } from "react";
import { CaretRight, ChatCircleText, Folder, House, Sparkle, X } from "@phosphor-icons/react";
import type { ProjectNode } from "./data.ts";
import { useHost } from "./host.ts";
import { relativeTime } from "./time.ts";
import { Button, Notice } from "./ui.tsx";

export function folderPath(nodes: ProjectNode[], id: string): ProjectNode[] {
  const byId = new Map(nodes.map(node => [node.node_id, node]));
  const path: ProjectNode[] = [], seen = new Set<string>();
  for (let current = byId.get(id); current && !seen.has(current.node_id); current = current.parent_id ? byId.get(current.parent_id) : undefined) {
    seen.add(current.node_id);
    if (current.is_dir) path.unshift(current);
  }
  return path;
}

export function inFolder(nodes: ProjectNode[], nodeId: string, folder: string): boolean {
  const node = nodes.find(n => n.node_id === nodeId);
  if (folder) return node?.parent_id === folder;
  return !node?.parent_id || !nodes.some(n => n.is_dir && n.node_id === node.parent_id);
}

export function ExplorerFolders({ nodes, current, onOpen }: { nodes: ProjectNode[]; current: string; onOpen(id: string): void }) {
  const folders = nodes.filter(n => n.is_dir).sort((a, b) => folderPath(nodes, a.node_id).map(n => n.name).join("/").localeCompare(folderPath(nodes, b.node_id).map(n => n.name).join("/"), "ru"));
  return <nav aria-label="Папки проекта" className="space-y-1">
    <button type="button" aria-current={!current ? "page" : undefined} onClick={() => onOpen("")} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] ${!current ? "bg-selection-bg font-semibold" : "hover:bg-kumo-tint"}`}><House size={17} />Файлы проекта</button>
    {folders.map(folder => <button type="button" key={folder.node_id} aria-current={current === folder.node_id ? "page" : undefined} onClick={() => onOpen(folder.node_id)} style={{ paddingLeft: 12 + Math.min(5, folderPath(nodes, folder.node_id).length - 1) * 12 }} className={`flex w-full min-w-0 items-center gap-2 rounded-lg py-2 pr-2 text-left text-[14px] ${current === folder.node_id ? "bg-selection-bg font-semibold" : "hover:bg-kumo-tint"}`}><Folder size={17} className="shrink-0 text-kumo-brand" /><span className="truncate" title={folder.name}>{folder.name}</span></button>)}
  </nav>;
}

export function ExplorerPath({ nodes, current, onOpen }: { nodes: ProjectNode[]; current: string; onOpen(id: string): void }) {
  return <nav aria-label="Путь к папке" className="flex min-w-0 flex-wrap items-center gap-1 text-[14px]">
    <button type="button" onClick={() => onOpen("")} className="rounded-md px-2 py-1 hover:bg-kumo-tint">Файлы</button>
    {folderPath(nodes, current).map(folder => <span className="flex min-w-0 items-center gap-1" key={folder.node_id}><CaretRight size={12} className="text-kumo-subtle" /><button type="button" aria-current={folder.node_id === current ? "page" : undefined} onClick={() => onOpen(folder.node_id)} className="max-w-[240px] truncate rounded-md px-2 py-1 font-medium hover:bg-kumo-tint" title={folder.name}>{folder.name}</button></span>)}
  </nav>;
}

export type ExplorerTarget = { nodeId: string; name: string; folder?: boolean; privateOnly?: boolean };
export function explorerPrompt(_project: string, targets: ExplorerTarget[], task: string): string {
  const references = targets.map(target => `- ${target.folder ? "Папка" : "Файл"} «${target.name}»`).join("\n");
  return `${task.trimEnd()}${references ? `\n\nМатериалы для задачи:\n${references}` : "\n\nИспользуй материалы подключённого проекта."}`;

}

export function ExplorerAssistant({ targets, contextName, onClear, onStart }: { targets: ExplorerTarget[]; contextName: string; onClear(): void; onStart(task: string): Promise<void> }) {
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  async function start(text: string) { if (busy || !text.trim()) return; setBusy(true); try { await onStart(text.trim()); } finally { setBusy(false); } }
  return <section id="project-assistant" aria-label="Задача агенту по материалам" className="rounded-xl border border-kumo-fill bg-kumo-overlay p-4">
    <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold"><Sparkle size={18} className="text-kumo-brand" />Mnemos</h2>
    <p className="mb-3 mt-2 text-[13px] text-kumo-subtle">{targets.length ? `Выбрано: ${targets.length}` : contextName}</p>
    {targets.length > 0 && <div className="mb-3 flex items-start gap-1"><div className="min-w-0 flex-1 space-y-1">{targets.slice(0, 4).map(target => <div key={target.nodeId} className="truncate text-[13px]" title={target.name}>{target.folder ? "Папка: " : ""}{target.name}</div>)}{targets.length > 4 && <div className="text-[12px] text-kumo-subtle">Ещё {targets.length - 4}</div>}</div><button type="button" onClick={onClear} aria-label="Снять выбор материалов" className="rounded p-1 hover:bg-kumo-tint"><X size={16} /></button></div>}
    <div className="mb-3 flex flex-wrap gap-1.5">{[
      ["Сводка", "Сделай краткую сводку материалов: главное, решения и открытые вопросы."],
      ["Выделить задачи", "Извлеки задачи из материалов. Укажи ответственных и сроки, если они есть в источниках."],
      ["Найти противоречия", "Сопоставь материалы и найди противоречия, расхождения и недостающую информацию."]
    ].map(([label, prompt]) => <button type="button" key={label} disabled={busy} onClick={() => setTask(prompt)} className="rounded-lg border border-kumo-fill px-2 py-1.5 text-left text-[12px] hover:bg-kumo-tint disabled:opacity-50">{label}</button>)}</div>
    <textarea aria-label="Задача Mnemos" placeholder="Что сделать с материалами?" rows={4} value={task} onChange={event => setTask(event.target.value)} className="w-full resize-y rounded-lg border border-kumo-fill bg-kumo-base p-3 text-[14px] outline-none focus:border-kumo-brand" />
    <Button icon={ChatCircleText} disabled={busy || !task.trim()} onClick={() => void start(task)} className="mt-2 w-full">{busy ? "Открываю…" : "Продолжить в беседе"}</Button>
    <p className="mb-0 mt-2 text-[12px] leading-4 text-kumo-subtle">Задача откроется в поле ввода. Можно уточнить её перед отправкой.</p>
  </section>;
}

export function ProjectConversations({ project }: { project: string }) {
  const host = useHost();
  type ChatPage = Pick<Awaited<ReturnType<typeof host.listProjectChats>>, "chats" | "next" | "failed">;
  const [page, setPage] = useState<ChatPage | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const loading = useRef(false), retryOffset = useRef(0);
  const pages = useRef(new Map<number, ChatPage>());
  async function load(offset = 0) {
    if (loading.current) return;
    loading.current = true; retryOffset.current = offset; setBusy(true); setError("");
    try {
      let next;
      try { next = await host.listProjectChats(project, offset); }
      catch { next = await host.listProjectChats(project, offset); }
      pages.current.set(offset, next);
      const ordered = [...pages.current.entries()].sort((a, b) => a[0] - b[0]);
      const unique = new Map(ordered.flatMap(([, slice]) => slice.chats.map(chat => [`${chat.workspaceId}/${chat.chatId}`, chat] as const)));
      setPage({ chats: [...unique.values()], next: ordered.at(-1)![1].next, failed: ordered.reduce((sum, [, slice]) => sum + slice.failed, 0) }); }

    catch { setError("Не удалось прочитать беседы. Повторите попытку."); }
    finally { loading.current = false; setBusy(false); }
  }
  useEffect(() => { void load(); }, [project]);
  return <section aria-label="Беседы проекта">
    <p className="mt-0 text-[13px] text-kumo-subtle">Ваши беседы, к которым подключён этот проект.</p>
    {error && <div className="mb-4 rounded-xl border border-kumo-fill bg-kumo-overlay p-4"><p role="alert" className="mt-0 text-[14px]">{error}</p><Button variant="secondary" size="sm" disabled={busy} onClick={() => void load(retryOffset.current)}>Повторить загрузку</Button></div>}
    {page?.failed ? <Notice>Часть бесед не загрузилась ({page.failed}). <Button variant="secondary" size="sm" disabled={busy} onClick={() => void load([...pages.current].find(([, slice]) => slice.failed > 0)?.[0] ?? 0)}>Повторить загрузку</Button></Notice> : null}
    <div className="overflow-hidden rounded-xl border border-kumo-fill bg-kumo-overlay">{page?.chats.map(chat => <button type="button" key={`${chat.workspaceId}/${chat.chatId}`} onClick={() => void host.openProjectChat(chat.workspaceId, chat.chatId).catch(() => setError("Не удалось открыть беседу."))} className="flex w-full items-center gap-3 border-t border-kumo-fill px-4 py-4 text-left first:border-0 hover:bg-kumo-tint"><ChatCircleText size={22} className="shrink-0 text-kumo-brand" /><span className="min-w-0 flex-1 truncate text-[15px]">{chat.title}</span><span className="shrink-0 text-[12px] text-kumo-subtle">{relativeTime(chat.at)}</span></button>)}</div>
    {busy && <p role="status" className="text-[13px] text-kumo-subtle">Ищу беседы проекта…</p>}
    {!busy && page && !page.chats.length && <p className="text-[14px] text-kumo-subtle">{page.next !== null ? "В недавних беседах этот проект пока не найден. Можно посмотреть более ранние." : "Бесед с этим проектом пока нет. Начните новую беседу."}</p>}
    {!busy && page?.next !== null && page?.next !== undefined && <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load(page.next!)}>Посмотреть более ранние</Button>}
  </section>;
}
