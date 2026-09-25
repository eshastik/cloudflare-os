import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CaretRight, FileText, Folder, GitBranch } from "@phosphor-icons/react";
import type { WorkspaceTaskView } from "../src/workspace-tasks.ts";
import type { GitBranch as Branch, GitChangedFile, GitComparison, GitProjectRepository, GitTreeEntry } from "../src/git-connections.ts";
import { useUi } from "./host.ts";
import { useLoad } from "./data.ts";
import { Button, AdminDetails, Block, Notice, Row, RowList, RowText, Select, StatusBadge, type BadgeTone } from "./ui.tsx";

const AGENT_PREFIX = "agents/";
const DIFF_LINES = 400;
const CHANGE: Record<GitChangedFile["status"], { tone: BadgeTone; label: string }> = {
  added: { tone: "success", label: "Добавлен" },
  modified: { tone: "info", label: "Изменён" },
  deleted: { tone: "danger", label: "Удалён" },
  renamed: { tone: "neutral", label: "Переименован" },
};

/** Код проекта только на чтение: дерево и файл выбранной ветки, ветки агентов и их изменения. */
/** Сравнение, открытое из задачи агента: репозиторий и ветка задачи. */
export interface CompareTarget { connection_id: string; repository_id: string; branch: string }

/** Имя версии для человека: основная, изменения агента по заголовку задачи, иначе имя ветки как его дал человек. */
function branchLabel(name: string, main: string, tasks: Map<string, string>, agentIndex: Map<string, number>): string {
  if (name === main) return "Основная версия";
  if (!name.startsWith(AGENT_PREFIX)) return name;
  const title = tasks.get(name);
  return title ? `Изменения агента: ${title}` : `Изменения агента № ${agentIndex.get(name) ?? 1}`;
}

export default function ProjectCode({ projectId, repositories, compareTo, actions, admin = false }: { projectId: string; repositories: GitProjectRepository[]; compareTo?: CompareTarget | null; actions?: ReactNode; admin?: boolean }) {
  const [repoKey, setRepoKey] = useState(() => key(repositories.find(r => compareTo && key(r) === key(compareTo)) ?? repositories[0]));
  const repo = repositories.find(r => key(r) === repoKey) ?? repositories[0];
  return (
    <div>
      {repositories.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-[14px] text-kumo-subtle">
          Код
          <Select aria-label="Репозиторий" value={key(repo)} onChange={e => setRepoKey(e.target.value)}>
            {repositories.map(r => <option key={key(r)} value={key(r)}>{r.repository_name}</option>)}
          </Select>
        </label>
      )}
      <Repository key={key(repo)} admin={admin} projectId={projectId} repo={repo} compareBranch={compareTo && key(compareTo) === key(repo) ? compareTo.branch : ""} actions={actions} />
    </div>
  );
}

function key(r: { connection_id: string; repository_id: string } | undefined): string {
  return r ? `${r.connection_id}/${r.repository_id}` : "";
}

function Repository({ admin, projectId, repo, compareBranch, actions }: { admin: boolean; projectId: string; repo: GitProjectRepository; compareBranch: string; actions?: ReactNode }) {
  const ui = useUi();
  // Заголовки задач дают изменениям агентов человеческое имя; без них — порядковый номер.
  const tasks = useLoad(async () => new Map((await ui.listWorkspaceTasks(projectId)).tasks.map((t: WorkspaceTaskView) => [t.branch, t.title])), "", [ui, projectId]);
  const coords = [projectId, repo.connection_id, repo.repository_id] as const;
  const branches = useLoad(() => ui.listGitBranches(...coords, 1), "Код проекта не прочитан. Проверьте доступ к проекту и обновите страницу.", [ui, ...coords]);
  const all = branches.value?.branches ?? [];
  const main = all.find(b => b.name === "main") ?? all.find(b => b.name === "master") ?? all.find(b => !b.name.startsWith(AGENT_PREFIX)) ?? all[0];
  const [selected, setSelected] = useState("");
  const [compare, setCompare] = useState<Branch | null>(null);
  const branch = all.find(b => b.name === selected) ?? main;
  const agentBranches = all.filter(b => b.name.startsWith(AGENT_PREFIX));
  const agentIndex = new Map(agentBranches.map((b, i) => [b.name, i + 1]));
  const label = (name: string) => branchLabel(name, main?.name ?? "", tasks.value ?? new Map(), agentIndex);
  // Переход из задачи агента открывает сравнение её ветки, как только ветки прочитаны.
  useEffect(() => {
    const target = compareBranch ? all.find(b => b.name === compareBranch) : undefined;
    if (target) setCompare(target);
  }, [compareBranch, branches.value]);

  if (branches.loading) return <Notice>Загружаем репозиторий…</Notice>;
  if (branches.error) return <Notice tone="danger">{branches.error}</Notice>;
  if (!branch) return <Notice>Код пока пуст. Он появится после первой отправки изменений.</Notice>;
  if (compare && main) return <Comparison admin={admin} projectId={projectId} repo={repo} base={main} head={compare} title={label(compare.name)} onBack={() => setCompare(null)} />;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-medium text-kumo-default">{repo.repository_name}</span>
        <Select aria-label="Версия кода" value={branch.name} onChange={e => setSelected(e.target.value)}>
          {all.map(b => <option key={b.name} value={b.name}>{label(b.name)}</option>)}
        </Select>
        <div className="flex-1" />
        {actions}
      </div>
      {compareBranch && !all.some(b => b.name === compareBranch) && <div className="mb-3"><Notice>Изменений задачи пока нет: агент ещё не сохранил их.</Notice></div>}
      <Browser key={branch.sha} projectId={projectId} repo={repo} branch={branch} />
      <Block title="Изменения агентов" count={agentBranches.length} empty="Агенты ещё не отправляли изменений. Они появятся здесь.">
        <RowList>
          {agentBranches.map(b => (
            <Row key={b.name} className="items-start">
              <GitBranch size={16} className="mt-0.5 shrink-0 text-kumo-subtle" aria-hidden="true" />
              <RowText title={label(b.name)} note="ещё не в основной версии"><AdminDetails show={admin} items={[["Ветка", b.name]]} /></RowText>
              <Button variant="secondary" size="sm" onClick={() => setCompare(b)} disabled={!main || main.name === b.name}>Показать изменения</Button>
            </Row>
          ))}
        </RowList>
      </Block>
    </div>
  );
}

function Browser({ projectId, repo, branch }: { projectId: string; repo: GitProjectRepository; branch: Branch }) {
  const ui = useUi();
  const coords = [projectId, repo.connection_id, repo.repository_id] as const;
  const [path, setPath] = useState("");
  const [file, setFile] = useState("");
  const commit = useLoad(() => ui.readGitCommit(...coords, branch.sha), "", [ui, ...coords, branch.sha]);
  const tree = useLoad(() => ui.readGitTree(...coords, branch.sha, path), "Каталог не прочитан. Проверьте доступ и повторите.", [ui, ...coords, branch.sha, path]);
  const entries = useMemo(() => [...(tree.value?.entries ?? [])].sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name, "ru")), [tree.value]);
  const crumbs = (file || path).split("/").filter(Boolean);
  const open = (entry: GitTreeEntry) => {
    if (entry.type === "dir") { setPath(entry.path); setFile(""); }
    else if (entry.type === "file") setFile(entry.path);
  };
  const go = (index: number) => { setFile(""); setPath(crumbs.slice(0, index).join("/")); };

  return (
    <section aria-label="Файлы репозитория" className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[14px]">
        <nav aria-label="Путь" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button type="button" className="text-kumo-link hover:underline" onClick={() => go(0)}>{repo.repository_name.split("/").at(-1)}</button>
          {crumbs.map((part, index) => (
            <span key={index} className="flex items-center gap-1">
              <CaretRight size={11} className="text-kumo-subtle" aria-hidden="true" />
              {index === crumbs.length - 1
                ? <span aria-current="location" className="font-medium text-kumo-default">{part}</span>
                : <button type="button" className="text-kumo-link hover:underline" onClick={() => go(index + 1)}>{part}</button>}
            </span>
          ))}
        </nav>
        {commit.value && <span className="text-[13px] text-kumo-subtle">{commit.value.message.split("\n")[0].slice(0, 72)} · {new Date(commit.value.committed_at).toLocaleDateString("ru-RU")}</span>}
      </div>
      {file
        ? <FileView projectId={projectId} repo={repo} commit={branch.sha} path={file} onClose={() => setFile("")} />
        : tree.loading ? <Notice>Загружаем файлы…</Notice>
        : tree.error ? <Notice tone="danger">{tree.error}</Notice>
        : entries.length === 0 ? <Notice>Каталог пуст.</Notice>
        : <>
            <RowList>
              {entries.map(entry => (
                <Row key={entry.path} className="py-2">
                  {entry.type === "dir"
                    ? <Folder size={16} className="shrink-0 text-kumo-subtle" aria-hidden="true" />
                    : <FileText size={16} className="shrink-0 text-kumo-subtle" aria-hidden="true" />}
                  <button type="button" disabled={entry.type !== "dir" && entry.type !== "file"} onClick={() => open(entry)}
                    className="min-w-0 flex-1 truncate text-left text-[14px] text-kumo-default hover:underline disabled:no-underline disabled:text-kumo-subtle">{entry.name}</button>
                  {entry.type === "file" && <span className="text-[13px] text-kumo-subtle">{size(entry.size_bytes)}</span>}
                  {entry.type === "symlink" && <span className="text-[13px] text-kumo-subtle">ссылка</span>}
                  {entry.type === "submodule" && <span className="text-[13px] text-kumo-subtle">подмодуль</span>}
                </Row>
              ))}
            </RowList>
            {tree.value?.truncated && <p className="mt-2 mb-0 text-[13px] text-kumo-subtle">Показаны первые {entries.length} записей каталога.</p>}
          </>}
    </section>
  );
}

function FileView({ projectId, repo, commit, path, onClose }: { projectId: string; repo: GitProjectRepository; commit: string; path: string; onClose(): void }) {
  const ui = useUi();
  const file = useLoad(() => ui.readGitFile(projectId, repo.connection_id, repo.repository_id, commit, path), "Файл не показан: он больше 256 КБ, не текстовый или недоступен.", [ui, projectId, repo.connection_id, repo.repository_id, commit, path]);
  const lines = file.value ? file.value.content.replace(/\n$/, "").split("\n") : [];
  return (
    <div aria-label={`Файл ${path}`} role="region">
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-kumo-subtle">{file.value ? `${lines.length} строк · ${size(file.value.size_bytes)}` : ""}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>К списку файлов</Button>
      </div>
      {file.loading ? <Notice>Загружаем файл…</Notice>
        : file.error ? <Notice tone="danger">{file.error}</Notice>
        : (
          <div className="overflow-x-auto rounded-[16px] border border-kumo-fill bg-kumo-overlay">
            <table className="w-full border-collapse font-mono text-[12.5px] leading-5">
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index}>
                    <td className="w-px select-none whitespace-nowrap px-3 text-right align-top text-kumo-inactive">{index + 1}</td>
                    <td className="whitespace-pre pr-4 text-kumo-default">{line || " "}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

function Comparison({ admin, projectId, repo, base, head, title, onBack }: { admin: boolean; projectId: string; repo: GitProjectRepository; base: Branch; head: Branch; title: string; onBack(): void }) {
  const ui = useUi();
  const result = useLoad(() => ui.compareGitRefs(projectId, repo.connection_id, repo.repository_id, base.name, head.name), "Сравнение не получено. Проверьте доступ и повторите.", [ui, projectId, repo.connection_id, repo.repository_id, base.name, head.name]);
  const value = result.value;
  return (
    <section aria-label="Сравнение версий">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[15px] font-semibold text-kumo-strong">{title}</h3>
          <p className="mt-0.5 mb-0 text-[13px] text-kumo-subtle">по сравнению с основной версией{value ? ` · сохранений: ${value.total_commits}` : ""}</p>
          <AdminDetails show={admin} items={[["Ветка", head.name], ["Основа", base.name]]} />
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>К коду проекта</Button>
      </div>
      {result.loading ? <Notice>Сравниваем версии…</Notice>
        : result.error ? <Notice tone="danger">{result.error}</Notice>
        : value && <ComparisonBody value={value} />}
    </section>
  );
}

function ComparisonBody({ value }: { value: GitComparison }) {
  const sections = useMemo(() => splitDiff(value.diff), [value.diff]);
  if (value.files.length === 0) return <Notice>Изменений по сравнению с основной версией нет.</Notice>;
  return (
    <div>
      <Block title="Изменённые файлы" count={value.files.length}>
        <RowList>
          {value.files.map(f => (
            <Row key={f.path} className="py-2">
              <RowText title={f.path} note={f.old_path ? `было: ${f.old_path}` : undefined} />
              {f.binary ? <span className="text-[13px] text-kumo-subtle">двоичный</span> : (
                <span className="whitespace-nowrap text-[13px]"><span className="text-kumo-success">+{f.additions}</span> <span className="text-kumo-danger">−{f.deletions}</span></span>
              )}
              <StatusBadge tone={CHANGE[f.status].tone}>{CHANGE[f.status].label}</StatusBadge>
            </Row>
          ))}
        </RowList>
        {!value.files_complete && <p className="mt-2 mb-0 text-[13px] text-kumo-subtle">Список неполный: изменения слишком большие для показа целиком.</p>}
      </Block>
      <section aria-label="Изменения по строкам">
        {sections.map((s, index) => <DiffFile key={index} section={s} open={index < 5} />)}
        {value.diff_truncated && <Notice>Показана только часть изменений: остальное слишком велико для просмотра здесь.</Notice>}
      </section>
    </div>
  );
}

interface DiffSection { path: string; lines: string[] }

function splitDiff(diff: string): DiffSection[] {
  const out: DiffSection[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/.* b\/(.*)$/.exec(line);
      out.push({ path: match?.[1] ?? line.slice(11), lines: [] });
    } else if (out.length && !/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)/.test(line)) {
      out[out.length - 1].lines.push(line);
    }
  }
  return out.filter(s => s.lines.some(l => l.length));
}

function DiffFile({ section, open }: { section: DiffSection; open: boolean }) {
  const [limit, setLimit] = useState(DIFF_LINES);
  const [expanded, setExpanded] = useState(open);
  useEffect(() => setExpanded(open), [open]);
  const shown = section.lines.slice(0, limit);
  return (
    <details open={expanded} onToggle={e => setExpanded((e.target as HTMLDetailsElement).open)} className="mb-3 overflow-hidden rounded-[16px] border border-kumo-fill bg-kumo-overlay">
      <summary className="cursor-pointer px-3 py-2 text-[14px] font-medium text-kumo-default">{section.path}</summary>
      <div className="overflow-x-auto border-t border-kumo-fill">
        <pre className="m-0 font-mono text-[12.5px] leading-5">
          {shown.map((line, index) => (
            <div key={index} className={`whitespace-pre px-3 ${line.startsWith("+") ? "bg-kumo-success-tint" : line.startsWith("-") ? "bg-kumo-danger-tint" : line.startsWith("@@") ? "text-kumo-subtle" : "text-kumo-default"}`}>{line || " "}</div>
          ))}
        </pre>
      </div>
      {section.lines.length > limit && (
        <div className="border-t border-kumo-fill px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setLimit(n => n + DIFF_LINES)}>Показать ещё {Math.min(DIFF_LINES, section.lines.length - limit)} строк</Button>
        </div>
      )}
    </details>
  );
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}
