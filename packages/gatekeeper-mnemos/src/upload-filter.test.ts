import {test} from "node:test";
import assert from "node:assert/strict";
import {
  builtinDirectoryReason, gitignoreDecision, megabytes, parseGitignore, skippedFilesPhrase, selectUploadFiles, skippedGroupsText, treeFromPaths,
  type UploadTreeDir, type UploadTreeNode,
} from "./upload-filter.ts";

// Дерево из описания: строка — файл с содержимым «x», объект — каталог.
type Spec = {[name: string]: string | Spec};
function tree(name: string, spec: Spec, reads: string[] = []): UploadTreeDir<string> {
  return {
    kind: "dir", name,
    children: async () => Object.entries(spec).map(([child, value]): UploadTreeNode<string> => typeof value === "string"
      ? {kind: "file", name: child, load: async () => { reads.push(child); return value; }}
      : tree(child, value, reads)),
  };
}
const text = async (value: string) => value;
const paths = (items: {path: string}[]) => items.map(item => item.path).sort();

test("служебные каталоги и файлы проекта не загружаются, материалы — загружаются", async () => {
  const reads: string[] = [];
  const root = tree("Проект", {
    "README.md": "x", "Отчёт.docx": "x", ".DS_Store": "x", "package.json": "x", "pyproject.toml": "x",
    ".git": {"HEAD": "x", "objects": {"ab": "x"}},
    "node_modules": {"react": {"index.js": "x", "package.json": "x"}},
    ".venv": {"lib": {"site-packages": {"x.py": "x"}}},
    "env": {"pyvenv.cfg": "x", "bin": {"python": "x"}},
    "src": {"app.py": "x", "__pycache__": {"app.cpython-312.pyc": "x"}, "mod.pyc": "x"},
    "dist": {"bundle.js": "x"},
    "pkg.egg-info": {"PKG-INFO": "x"},
    ".idea": {"workspace.xml": "x"},
  }, reads);
  const selection = await selectUploadFiles(root, text);
  assert.deepEqual(paths(selection.kept), ["Проект/README.md", "Проект/package.json", "Проект/pyproject.toml", "Проект/src/app.py", "Проект/Отчёт.docx"]);
  assert.equal(selection.skipped.length, 13);
  const groups = Object.fromEntries(selection.groups.map(group => [group.label, group.files]));
  assert.deepEqual(groups, {".git": 2, "node_modules": 2, ".venv": 1, "окружение Python": 2, "__pycache__": 1, "*.pyc": 1, "dist": 1, "*.egg-info": 1, ".idea": 1, ".DS_Store": 1});
  assert.ok(selection.skippedDirs.includes("Проект/.git"));
  // Содержимое служебных файлов не читается: ни одного load() кроме .gitignore (его здесь нет).
  assert.deepEqual(reads, []);
});

test("build, dist, vendor и target — служебные только рядом с файлом сборки", () => {
  const none = new Set<string>(["Договор.docx"]);
  for (const name of ["build", "dist", "vendor", "target", "coverage", "bin", "out"]) assert.equal(builtinDirectoryReason(name, none), null, name);
  assert.equal(builtinDirectoryReason("vendor", new Set(["go.mod"])), "vendor");
  assert.equal(builtinDirectoryReason("vendor", new Set(["composer.json"])), "vendor");
  assert.equal(builtinDirectoryReason("target", new Set(["Cargo.toml"])), "target");
  assert.equal(builtinDirectoryReason("build", new Set(["package.json"])), "build");
  assert.equal(builtinDirectoryReason("bin", new Set(["App.csproj"])), "bin");
  assert.equal(builtinDirectoryReason("node_modules", none), "node_modules");
  assert.equal(builtinDirectoryReason("старый env", none, new Set(["pyvenv.cfg"])), "окружение Python");
});

test("шаблоны .gitignore: *, **, якорь /, каталоги со слэшем, отрицание !", () => {
  const rules = parseGitignore([
    "# комментарий", "", "*.log", "!keep.log", "/secret.txt", "tmp/", "docs/**/*.bak", "**/generated",
    "build-*/", "a/**", "\\#hash", "foo\\ ", "data/*.csv",
  ].join("\n"));
  const check = (path: string, dir = false) => gitignoreDecision(rules, path.split("/"), dir);
  assert.equal(check("app.log"), true);
  assert.equal(check("deep/in/app.log"), true);
  assert.equal(check("deep/keep.log"), false, "! возвращает файл");
  assert.equal(check("secret.txt"), true);
  assert.equal(check("sub/secret.txt"), null, "/ в начале — только корень");
  assert.equal(check("tmp", true), true);
  assert.equal(check("tmp"), null, "слэш в конце — только каталог");
  assert.equal(check("x/tmp", true), true, "без слэша внутри — на любой глубине");
  assert.equal(check("docs/a.bak"), true, "** — ноль каталогов");
  assert.equal(check("docs/x/y/a.bak"), true);
  assert.equal(check("other/a.bak"), null);
  assert.equal(check("x/y/generated", true), true);
  assert.equal(check("build-1", true), true);
  assert.equal(check("a/b/c.txt"), true, "a/** — всё внутри");
  assert.equal(check("a", true), null);
  assert.equal(check("#hash"), true);
  assert.equal(check("foo "), true, "экранированный пробел в конце");
  assert.equal(check("data/x.csv"), true);
  assert.equal(check("data/sub/x.csv"), null, "* не переходит через /");
  assert.equal(check("sub/data/x.csv"), null, "шаблон со слэшем привязан к каталогу .gitignore");
  const classes = parseGitignore("report[0-9].txt\nfile?.md\n[!a]*.tmp");
  assert.equal(gitignoreDecision(classes, ["report7.txt"], false), true);
  assert.equal(gitignoreDecision(classes, ["reportX.txt"], false), null);
  assert.equal(gitignoreDecision(classes, ["file1.md"], false), true);
  assert.equal(gitignoreDecision(classes, ["b.tmp"], false), true);
  assert.equal(gitignoreDecision(classes, ["a.tmp"], false), null);
});

test(".gitignore корня и вложенных каталогов применяется при обходе; поздний шаблон главнее", async () => {
  const root = tree("Сайт", {
    ".gitignore": "*.log\n/output/\nsecrets/\n!important.log\n",
    "app.log": "x", "important.log": "x", "index.html": "x",
    "output": {"a.html": "x"},
    "docs": {"secrets": {"key.txt": "x"}, "guide.md": "x", "output": {"kept.html": "x"},
      ".gitignore": "*.draft\n!final.log\n", "note.draft": "x", "final.log": "x"},
  });
  const selection = await selectUploadFiles(root, text);
  assert.deepEqual(paths(selection.kept), [
    "Сайт/.gitignore", "Сайт/docs/.gitignore", "Сайт/docs/final.log", "Сайт/docs/guide.md", "Сайт/docs/output/kept.html",
    "Сайт/important.log", "Сайт/index.html",
  ]);
  assert.equal(selection.groups.find(group => group.label === "по .gitignore")?.files, 4, "app.log, output/a.html, docs/secrets/key.txt, note.draft");
});

test("«загрузить всё» — без отбора; отобранное всё равно доступно по списку пропущенных", async () => {
  const root = tree("П", {"node_modules": {"a.js": "x"}, "b.txt": "x", ".gitignore": "b.txt"});
  const all = await selectUploadFiles(root, text, {filter: false});
  assert.deepEqual(paths(all.kept), ["П/.gitignore", "П/b.txt", "П/node_modules/a.js"]);
  const filtered = await selectUploadFiles(root, text);
  assert.deepEqual(paths(filtered.kept), ["П/.gitignore"]);
  assert.deepEqual(paths(filtered.skipped), ["П/b.txt", "П/node_modules/a.js"]);
});

test("плоский список выбора папки превращается в то же дерево и отбирается так же", async () => {
  const items = ["Проект/a.md", "Проект/node_modules/x/i.js", "Проект/src/b.ts", "Проект/.gitignore", "Проект/src/b.js"].map(path => ({path, file: path === "Проект/.gitignore" ? "*.js" : "x"}));
  const [root] = treeFromPaths(items);
  const selection = await selectUploadFiles(root, text);
  assert.deepEqual(paths(selection.kept), ["Проект/.gitignore", "Проект/a.md", "Проект/src/b.ts"]);
  assert.equal(selection.skipped.length, 2);
  const loose = treeFromPaths([{path: "один.txt", file: "x"}]);
  assert.deepEqual(paths((await selectUploadFiles(loose[0], text)).kept), ["один.txt"]);
});

test("95 тысяч служебных файлов не упираются в предел числа файлов", async () => {
  const items = [{path: "Проект/main.py", file: "x"}];
  for (let i = 0; i < 95_000; i++) items.push({path: `Проект/.venv/lib/site-packages/p${i % 900}/m${i}.py`, file: "x"});
  const [root] = treeFromPaths(items);
  const selection = await selectUploadFiles(root, text);
  assert.deepEqual(paths(selection.kept), ["Проект/main.py"]);
  assert.equal(selection.skipped.length, 95_000);
  assert.deepEqual(selection.groups, [{label: ".venv", files: 95_000}]);
});

test("предел обхода: пропущенное считается «не меньше», оставшееся — ошибка", async () => {
  const items = [{path: "П/a.md", file: "x"}];
  for (let i = 0; i < 50; i++) items.push({path: `П/node_modules/m${i}.js`, file: "x"});
  const selection = await selectUploadFiles(treeFromPaths(items)[0], text, {maxEntries: 20});
  assert.equal(selection.truncated, true);
  const many = Array.from({length: 30}, (_, i) => ({path: `П/f${i}.md`, file: "x"}));
  await assert.rejects(selectUploadFiles(treeFromPaths(many)[0], text, {maxEntries: 20}), /слишком много файлов/);
});

test("сводка причин короткая, числа — по-русски", () => {
  assert.equal(megabytes(0), "0 МБ");
  assert.equal(megabytes(2048), "меньше 0,1 МБ");
  assert.equal(megabytes(3.5 * 1024 * 1024), "3,5 МБ");
  assert.equal(megabytes(120 * 1024 * 1024), "120 МБ");
  assert.equal(skippedFilesPhrase(1), "1 служебный файл");
  assert.equal(skippedFilesPhrase(3), "3 служебных файла");
  assert.equal(skippedFilesPhrase(95000), "95000 служебных файлов");
  assert.equal(skippedGroupsText([{label: "node_modules", files: 9}, {label: ".venv", files: 5}]), "node_modules, .venv");
  assert.equal(skippedGroupsText([1, 2, 3, 4, 5, 6].map(n => ({label: `g${n}`, files: n})), 4), "g1, g2, g3, g4 и ещё 2");
});
