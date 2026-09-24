// Отбор файлов папки перед загрузкой в память: служебные каталоги и файлы (зависимости, окружения
// Python, кэши, результаты сборки, настройки редакторов) материалами не являются. Решение
// принимается в браузере, до загрузки: каталог, признанный служебным, не читается дальше, чем нужно
// для подсчёта, и его файлы не превращаются в File. Общий модуль для всех путей загрузки папок:
// перетаскивание, выбор папки, проект из папки в беседе.

/** Узел дерева папки. Файл отдаёт своё содержимое лениво: для служебных файлов его не просят. */
export interface UploadTreeFile<F> { kind: "file"; name: string; load(): Promise<F> }
export interface UploadTreeDir<F> { kind: "dir"; name: string; children(): Promise<UploadTreeNode<F>[]> }
export type UploadTreeNode<F> = UploadTreeFile<F> | UploadTreeDir<F>;

export interface UploadCandidate<F> { path: string; node: UploadTreeFile<F> }
export interface SkippedGroup { label: string; files: number }
export interface UploadSelection<F> {
  kept: UploadCandidate<F>[];
  skipped: UploadCandidate<F>[];
  /** Причины пропуска по убыванию числа файлов: «node_modules», «.venv», «по .gitignore». */
  groups: SkippedGroup[];
  /** Пропущенные каталоги (пути от корня выбора); по ним, например, узнаётся папка с кодом. */
  skippedDirs: string[];
  /** Счёт пропущенного остановлен на пределе обхода: пропущено не меньше указанного. */
  truncated: boolean;
}

// Каталоги, которые не бывают материалами ни в какой папке.
const ALWAYS_SKIPPED_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "bower_components", ".pnpm-store", ".yarn",
  ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".pytype",
  ".tox", ".nox", ".eggs", "site-packages", ".ipynb_checkpoints",
  ".next", ".nuxt", ".svelte-kit", ".angular", ".expo", ".turbo", ".parcel-cache", ".sass-cache",
  ".cache", ".nyc_output", "htmlcov", ".gradle", ".dart_tool", ".terraform", ".serverless",
  ".idea", ".vscode",
]);
const ALWAYS_SKIPPED_DIR_SUFFIXES = [".egg-info", ".dist-info"];

// Каталоги с обычными словами в имени («build», «dist», «vendor») — служебные, только если рядом
// лежит файл сборки. В папке с документами каталог «build» может оказаться материалом.
const WEB_OR_PYTHON = ["package.json", "tsconfig.json", "deno.json", "pyproject.toml", "setup.py", "setup.cfg"];
const BUILD_OUTPUTS: Record<string, string[]> = {
  dist: WEB_OR_PYTHON,
  build: [...WEB_OR_PYTHON, "build.gradle", "build.gradle.kts", "CMakeLists.txt"],
  out: ["package.json", "tsconfig.json"],
  coverage: [...WEB_OR_PYTHON, "go.mod", "Cargo.toml"],
  target: ["Cargo.toml", "pom.xml", "build.sbt", "project.clj"],
  // vendor у Go и PHP — чужой код, который восстанавливается из go.mod / composer.lock; без
  // файла модуля рядом «vendor» может быть папкой с материалами поставщиков, её не трогаем.
  vendor: ["go.mod", "composer.json", "Gemfile"],
  Pods: ["Podfile"],
  ".build": ["Package.swift"],
  _build: ["mix.exs"],
  deps: ["mix.exs"],
};
const DOTNET_OUTPUTS = new Set(["bin", "obj"]);
const DOTNET_PROJECT = /\.(csproj|fsproj|vbproj|sln)$/i;

const SKIPPED_FILES = new Set([".DS_Store", "Thumbs.db", "ehthumbs.db", "desktop.ini", ".coverage", ".eslintcache", "Icon\r"]);
const SKIPPED_FILE_PATTERNS: { label: string; test: (name: string) => boolean }[] = [
  { label: "*.pyc", test: name => /\.py[cod]$/i.test(name) },
  { label: "*.class", test: name => /\.class$/i.test(name) },
  { label: "*.o", test: name => /\.o$/.test(name) },
  { label: "*.tsbuildinfo", test: name => name.endsWith(".tsbuildinfo") },
  { label: "временные файлы редактора", test: name => /^\.?.*\.sw[op]$/.test(name) || name.startsWith("~$") },
  { label: "служебные файлы macOS", test: name => name.startsWith("._") },
];

/** Причина пропуска каталога по встроенным правилам или null. siblings — имена в том же каталоге. */
export function builtinDirectoryReason(name: string, siblings: ReadonlySet<string>, children?: ReadonlySet<string>): string | null {
  if (ALWAYS_SKIPPED_DIRS.has(name)) return name;
  if (ALWAYS_SKIPPED_DIR_SUFFIXES.some(suffix => name.endsWith(suffix))) return `*${ALWAYS_SKIPPED_DIR_SUFFIXES.find(suffix => name.endsWith(suffix))}`;
  // Окружение Python под любым именем («env», «.env311») узнаётся по pyvenv.cfg внутри.
  if (children?.has("pyvenv.cfg")) return "окружение Python";
  const markers = BUILD_OUTPUTS[name];
  if (markers?.some(marker => siblings.has(marker))) return name;
  if (DOTNET_OUTPUTS.has(name) && [...siblings].some(sibling => DOTNET_PROJECT.test(sibling))) return name;
  return null;
}

export function builtinFileReason(name: string): string | null {
  if (SKIPPED_FILES.has(name)) return name === "Icon\r" ? "служебные файлы macOS" : name;
  return SKIPPED_FILE_PATTERNS.find(pattern => pattern.test(name))?.label ?? null;
}

// ---- .gitignore ----

export interface GitignoreRule { base: string[]; negate: boolean; dirOnly: boolean; anchored: boolean; regex: RegExp }

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "\\" && i + 1 < glob.length) { out += escapeRegex(glob[++i]); continue; }
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const before = i === 0 || glob[i - 1] === "/";
        const after = i + 2 === glob.length || glob[i + 2] === "/";
        if (before && after) {
          if (i + 2 === glob.length) { out += ".*"; i += 1; continue; }        // «a/**»: всё внутри
          out += "(?:.*/)?"; i += 2; continue;                                  // «**/» и «/**/»: любые каталоги
        }
        while (glob[i + 1] === "*") i++;                                       // прочие «**» — как «*»
      }
      out += "[^/]*"; continue;
    }
    if (ch === "?") { out += "[^/]"; continue; }
    if (ch === "[") {
      const close = glob.indexOf("]", i + 2);
      if (close !== -1) {
        let body = glob.slice(i + 1, close);
        const negated = body.startsWith("!") || body.startsWith("^");
        if (negated) body = body.slice(1);
        out += `[${negated ? "^/" : ""}${body.replace(/\\/g, "\\\\").replace(/]/g, "\\]")}]`;
        i = close; continue;
      }
    }
    out += escapeRegex(ch);
  }
  return out;
}

function escapeRegex(ch: string): string { return /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch; }

/** Шаблоны одного .gitignore, лежащего в каталоге base (сегменты пути от корня выбора). */
export function parseGitignore(text: string, base: string[] = []): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) { negate = true; line = line.slice(1); }
    else if (line.startsWith("\\!") || line.startsWith("\\#")) line = line.slice(1);
    line = line.replace(/\\(\s)$/, "$1");
    let dirOnly = false;
    if (line.endsWith("/")) { dirOnly = true; line = line.replace(/\/+$/, ""); }
    if (!line) continue;
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (!line) continue;
    try { rules.push({ base, negate, dirOnly, anchored, regex: new RegExp(`^${globToRegex(line)}$`) }); }
    catch { /* строка, которую git тоже не поймёт, правилом не становится */ }
  }
  return rules;
}

/** Решение правил git для пути (сегменты от корня выбора): true — исключён, false — возвращён «!», null — правила молчат. */
export function gitignoreDecision(rules: readonly GitignoreRule[], path: string[], isDir: boolean): boolean | null {
  let decision: boolean | null = null;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (path.length <= rule.base.length || rule.base.some((segment, i) => path[i] !== segment)) continue;
    const relative = path.slice(rule.base.length);
    const subject = rule.anchored ? relative.join("/") : relative[relative.length - 1];
    if (rule.regex.test(subject)) decision = !rule.negate;
  }
  return decision;
}

// ---- обход ----

export interface SelectOptions {
  /** false — ничего не отбирать (человек выбрал «загрузить всё»). */
  filter?: boolean;
  /** Предел числа просмотренных записей: огромную папку не перечисляем бесконечно. */
  maxEntries?: number;
  maxDepth?: number;
}

export const GITIGNORE_LABEL = "по .gitignore";

/**
 * Отбирает файлы дерева. Пути в результате начинаются с имени корня: «Проект/docs/a.md».
 * Корневой каталог сам не проверяется — его выбрал человек.
 */
export async function selectUploadFiles<F>(root: UploadTreeDir<F>, readText: (file: F) => Promise<string>, options: SelectOptions = {}): Promise<UploadSelection<F>> {
  const filter = options.filter !== false;
  const maxEntries = options.maxEntries ?? 500_000, maxDepth = options.maxDepth ?? 64;
  const kept: UploadCandidate<F>[] = [], skipped: UploadCandidate<F>[] = [], skippedDirs: string[] = [];
  const groups = new Map<string, number>();
  let seen = 0, truncated = false;
  const join = (path: string, name: string) => path ? `${path}/${name}` : name;
  const add = (label: string, count: number) => groups.set(label, (groups.get(label) ?? 0) + count);

  // Всё содержимое пропущенного каталога: считается и запоминается для «загрузить всё».
  async function drain(dir: UploadTreeDir<F>, path: string, depth: number): Promise<number> {
    if (depth > maxDepth || truncated) return 0;
    let count = 0;
    for (const child of await dir.children()) {
      if (++seen > maxEntries) { truncated = true; break; }
      const childPath = join(path, child.name);
      if (child.kind === "file") { skipped.push({ path: childPath, node: child }); count++; }
      else count += await drain(child, childPath, depth + 1);
    }
    return count;
  }

  async function visit(path: string, segments: string[], depth: number, rules: GitignoreRule[], children: UploadTreeNode<F>[]): Promise<void> {
    if (depth > maxDepth) throw Error("Слишком глубокая вложенность папок. Разделите загрузку на части.");
    const names = new Set(children.map(child => child.name));
    let local = rules;
    const gitignore = filter ? children.find((child): child is UploadTreeFile<F> => child.kind === "file" && child.name === ".gitignore") : undefined;
    if (gitignore) {
      try { local = [...rules, ...parseGitignore(await readText(await gitignore.load()), segments)]; }
      catch { /* нечитаемый .gitignore — просто без его правил */ }
    }
    for (const child of children) {
      if (++seen > maxEntries) throw Error("В папке слишком много файлов. Разделите загрузку на части.");
      const childPath = join(path, child.name), childSegments = [...segments, child.name];
      if (child.kind === "file") {
        const reason = filter ? builtinFileReason(child.name) ?? (gitignoreDecision(local, childSegments, false) ? GITIGNORE_LABEL : null) : null;
        if (reason) { skipped.push({ path: childPath, node: child }); add(reason, 1); }
        else kept.push({ path: childPath, node: child });
        continue;
      }
      const grandChildren = await child.children();
      const reason = filter
        ? builtinDirectoryReason(child.name, names, new Set(grandChildren.map(node => node.name))) ?? (gitignoreDecision(local, childSegments, true) ? GITIGNORE_LABEL : null)
        : null;
      if (reason) {
        skippedDirs.push(childPath);
        const cached: UploadTreeDir<F> = { kind: "dir", name: child.name, children: async () => grandChildren };
        add(reason, await drain(cached, childPath, depth + 1));
      } else await visit(childPath, childSegments, depth + 1, local, grandChildren);
    }
  }

  await visit(root.name, [], 0, [], await root.children());
  return {
    kept, skipped, skippedDirs, truncated,
    groups: [...groups].map(([label, files]) => ({ label, files })).sort((a, b) => b.files - a.files || a.label.localeCompare(b.label)),
  };
}

/** Дерево из плоского списка путей (выбор папки через input отдаёт именно его). */
export function treeFromPaths<F>(items: readonly { path: string; file: F }[]): UploadTreeDir<F>[] {
  type Draft = { name: string; dirs: Map<string, Draft>; files: UploadTreeFile<F>[] };
  const top: Draft = { name: "", dirs: new Map(), files: [] };
  for (const { path, file } of items) {
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) continue;
    let dir = top;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) { next = { name: part, dirs: new Map(), files: [] }; dir.dirs.set(part, next); }
      dir = next;
    }
    dir.files.push({ kind: "file", name: parts[parts.length - 1], load: async () => file });
  }
  const build = (draft: Draft): UploadTreeDir<F> => ({
    kind: "dir", name: draft.name,
    children: async () => [...draft.files, ...[...draft.dirs.values()].map(build)],
  });
  const roots = [...top.dirs.values()].map(build);
  // Файлы без каталога (выбраны поштучно) — в отдельном безымянном корне.
  if (top.files.length) roots.push({ kind: "dir", name: "", children: async () => top.files });
  return roots;
}

/** Сводка по-человечески: «node_modules, .venv, по .gitignore и ещё 3». */
export function skippedGroupsText(groups: readonly SkippedGroup[], shown = 4): string {
  const names = groups.slice(0, shown).map(group => group.label);
  const rest = groups.length - names.length;
  return rest > 0 ? `${names.join(", ")} и ещё ${rest}` : names.join(", ");
}

/** Склонение «файл»: 1 файл, 2 файла, 5 файлов. */
export function filesWord(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "файл";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "файла";
  return "файлов";
}

/** «1 служебный файл», «3 служебных файла», «5 служебных файлов». */
export function skippedFilesPhrase(n: number): string {
  const word = filesWord(n);
  return `${n} ${word === "файл" ? "служебный" : "служебных"} ${word}`;
}

export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (bytes > 0 && mb < 0.1) return "меньше 0,1 МБ";
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} МБ`.replace(".", ",");
}
