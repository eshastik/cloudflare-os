// Подписи хода работы агента и сторож реестра: каждый инструмент агента, каждое наблюдение,
// действие и чтение Mnemos описаны в toolDisplay.ts, и разные по смыслу виды не делят глагол.
// @ts-expect-error node builtin without @types/node
import { readFileSync } from "node:fs";
// @ts-expect-error node builtin without @types/node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiToolCall } from "@gadgets/workshop-shared/api";
import {
  AGENT_TOOL_DISPLAY, MNEMOS_ACTION_DISPLAY, MNEMOS_INFO_DISPLAY, MNEMOS_LEGACY_TITLES, MNEMOS_LIBRARY_METHODS,
  GADGET_METHODS, SHARED_PAST_VERBS, STEP_DISPLAY, actionDisplay, buildWorkSteps, callStep, describeLiveStep, formatDuration,
  groupSteps, summarizeRun, type ObservationRecord, type WorkBatch,
} from "./toolDisplay";

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), "utf8");

// ---- сторож реестра ----

function objectKeys(text: string, name: string): string[] {
  const start = text.indexOf(`export const ${name}`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const body = text.slice(text.indexOf("{", start) + 1, text.indexOf("\n};", start));
  return [...body.matchAll(/(?:^|[\s,{])([a-z_]+):\s*"/g)].map(m => m[1]);
}

describe("сторож: у каждого инструмента есть описание отображения", () => {
  it("инструменты агента беседы (workshop-backend/src/agent.ts)", () => {
    const agent = source("workshop-backend/src/agent.ts");
    const names = new Set([...agent.matchAll(/^\s+name: "([a-zA-Z]+)",$/gm)].map(m => m[1]));
    expect(names.size).toBeGreaterThanOrEqual(15);
    for (const name of names) expect(AGENT_TOOL_DISPLAY, name).toHaveProperty(name);
  });

  it("наблюдения Mnemos: заголовки и виды activity", () => {
    const texts = [source("gatekeeper-mnemos/src/agent-library.ts"), source("gatekeeper-mnemos/src/mnemos.ts")];
    const titles = new Set<string>();
    const kinds = new Set<string>();
    for (const text of texts) {
      for (const match of text.matchAll(/authorizeObservation\(/g)) {
        const call = text.slice(match.index!, match.index! + 700);
        const title = /title:\s*"([^"]+)"/.exec(call)?.[1];
        if (title) titles.add(title);
      }
      for (const match of text.matchAll(/kind:\s*"(mnemos\.[a-z.]+)"/g)) kinds.add(match[1]);
    }
    expect(titles.size).toBeGreaterThanOrEqual(14);
    for (const title of titles) expect(MNEMOS_LEGACY_TITLES, title).toHaveProperty([title]);
    for (const kind of kinds) expect(STEP_DISPLAY, kind).toHaveProperty([kind]);
  });

  it("действия Mnemos с карточкой подтверждения и чтения сведений", () => {
    const base = source("gatekeeper-mnemos/src/agent-actions.ts");
    const extra = source("gatekeeper-mnemos/src/agent-actions-extra.ts");
    const actions = [...objectKeys(base, "ACTION_LABELS: Record"), ...objectKeys(extra, "EXTRA_LABELS: Record")];
    expect(actions.length).toBeGreaterThanOrEqual(30);
    for (const kind of actions) expect(MNEMOS_ACTION_DISPLAY, kind).toHaveProperty(kind);
    const reads = [...objectKeys(base, "READ_TITLES: Record"), ...objectKeys(extra, "EXTRA_READ_TITLES: Record")];
    expect(reads.length).toBeGreaterThanOrEqual(15);
    for (const kind of reads) {
      expect(MNEMOS_INFO_DISPLAY, kind).toHaveProperty(kind);
      expect(STEP_DISPLAY, kind).toHaveProperty([`mnemos.info.${kind}`]);
    }
  });

  it("методы библиотеки MNEMOS, которые агент зовёт из кода", () => {
    const text = source("gatekeeper-mnemos/src/agent-library.ts");
    const body = text.slice(text.indexOf("export class MnemosLibrarySession"), text.indexOf("export class MnemosLibrary "));
    const methods = [...body.matchAll(/^\s+async (\w+)\(/gm)].map(m => m[1]);
    expect(methods.length).toBeGreaterThanOrEqual(50);
    for (const method of methods) {
      expect(MNEMOS_LIBRARY_METHODS, method).toHaveProperty(method);
      expect(STEP_DISPLAY, method).toHaveProperty([MNEMOS_LIBRARY_METHODS[method]]);
    }
  });

  it("методы встроенных редакторов (workshop-backend/src/native-editor-guard.ts)", () => {
    const guard = source("workshop-backend/src/native-editor-guard.ts");
    const methods = new Set([...guard.matchAll(/\$\{env\}\.(\w+)\(/g)].map(m => m[1]));
    expect(methods.size).toBeGreaterThanOrEqual(4);
    for (const method of methods) expect(GADGET_METHODS, method).toHaveProperty(method);
  });

  it("у каждого вида свой глагол; общий — только с причиной; «Выполнил действие» и общее «Прочитал» запрещены", () => {
    const byVerb = new Map<string, string[]>();
    const all = [
      ...Object.entries(STEP_DISPLAY).map(([kind, spec]) => [kind, spec] as const),
      ...Object.entries(MNEMOS_ACTION_DISPLAY).map(([kind, spec]) => [`action.${kind}`, spec] as const),
    ];
    for (const [kind, spec] of all) {
      expect(spec.past.trim(), kind).not.toBe("");
      expect(spec.present.trim(), kind).not.toBe("");
      expect(spec.failed.trim(), kind).not.toBe("");
      expect(spec.present, kind).not.toBe(spec.past);
      expect(spec.past, kind).not.toMatch(/^Выполнил действи/);
      if (spec.past === "Прочитал") expect(kind).toBe("tool.readFile");
      byVerb.set(spec.past, [...byVerb.get(spec.past) ?? [], kind]);
    }
    const shared = [...byVerb].filter(([, kinds]) => kinds.length > 1).map(([verb]) => verb);
    expect(shared.toSorted()).toEqual(Object.keys(SHARED_PAST_VERBS).toSorted());
  });
});

// ---- подписи ----

const call = (toolName: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ toolCallId: `${toolName}-${Math.random()}`, toolName, input, ...extra }) as unknown as AiToolCall;

describe("строки инструментов агента", () => {
  it("каждый инструмент говорит, что сделано, с главным параметром", () => {
    expect(callStep(call("readFile", { filename: "бэкенд/app/main.py", offset: 1, limit: 120 }))).toMatchObject({ label: "Прочитал бэкенд/app/main.py", meta: "строки 1–120" });
    expect(callStep(call("writeFile", { filename: "README.md", content: "a\nb" })).label).toBe("Записал README.md");
    expect(callStep(call("editFile", { filename: "app.ts", textToReplace: "x", replacement: "y" }))).toMatchObject({ label: "Изменил app.ts", detail: { type: "lines", lines: ["Было: x", "Стало: y"] } });
    expect(callStep(call("webFetch", { url: "https://example.org/docs" })).label).toBe("Открыл страницу example.org");
    expect(callStep(call("createGadget", { title: "Отчёт", bindingName: "R" })).label).toBe("Создал «Отчёт»");
    expect(callStep(call("requestConnection", { vendorId: "google", reason: "нужна почта" })).label).toBe("Попросил подключить google");
    expect(callStep(call("codeWork", { task: "x", projectId: "03df01061ae3e9db16ba4f6ed0531c04" }, { output: { projectTitle: "Склад", steps: [] } })).label).toBe("Поручил агенту кода «Склад»");
    expect(callStep(call("executeCode", { code: "// Считаю остатки по складам\nreturn 1" })).label).toBe("Запустил код: Считаю остатки по складам");
    expect(callStep(call("executeCode", { code: "await env.SHEET.addRow([1])" })).label).toBe("Запустил код: SHEET.addRow");
  });

  it("ошибка — «Не удалось …» и текст ошибки в раскрытии", () => {
    const step = callStep(call("readFile", { filename: "нет.txt" }, { error: "Файл не найден" }));
    expect(step.label).toBe("Не удалось прочитать файл нет.txt");
    expect(step.error).toBe("Файл не найден");
  });

  it("сырой идентификатор в строку не попадает", () => {
    expect(callStep(call("codeWork", { task: "x", projectId: "03df01061ae3e9db16ba4f6ed0531c04" })).label).toBe("Поручил агенту кода");
  });

  it("действие карточки: глагол по виду, для чужого ресурса — по смыслу, без «Выполнил действие»", () => {
    expect(actionDisplay("mnemos.share_document", "Поделиться").past).toBe("Открыл доступ к документу");
    expect(actionDisplay("mnemos.remove_person", "Удалить").past).toBe("Удалил из организации");
    expect(actionDisplay(undefined, "Создать проект").past).toBe("Создал проект");
    expect(actionDisplay("gmail:send_message", "Send email").past).toBe("Отправил письмо");
    expect(actionDisplay("cal:create_event", "Create event").past).toBe("Назначил встречу");
    expect(actionDisplay("x:y", "Что-то").past).not.toMatch(/Выполнил действие/);
  });
});

// ---- беседа «Устройство льва»: старые записи без activity ----

const LION = "03df01061ae3e9db16ba4f6ed0531c04";
let sequence = 0;
function observation(title: string, description: string, extra: Partial<ObservationRecord> = {}): ObservationRecord {
  return { chatId: 1, sequence: ++sequence, resourceTitle: "Mnemos", title, description, ...extra };
}
const materials = () => observation("Материалы Mnemos", "Поиск выполнен в проекте «Красноярский лев».", { workContext: { projectName: "Красноярский лев" } });
const QUERIES = ["session websocket audio microphone kiosk frontend files", "backend main", "kiosk", "audio pipeline", "websocket", "tts", "stt", "config", "docker"];

function lionBatches(): WorkBatch[] {
  return [
    { calls: [call("executeCode", { code: "const b = await env.MNEMOS.browseProject(p)" }, { output: "{…}" })], observations: [
      observation("Папки проекта Mnemos", `Проект «${LION}», папка «корень».`), materials(),
    ] },
    { calls: [call("executeCode", { code: "for (const q of qs) await env.MNEMOS.searchProject(p, q)" }, { output: "{…}" })], observations: [
      ...QUERIES.flatMap(query => [observation("Поиск в Mnemos", `Проект «${LION}», запрос: «${query}».`), materials()]),
      observation("Чтение документа Mnemos", `Проект «${LION}», документ «README.md» (${"a".repeat(64)}), публикация ev1.`),
      observation("Материалы Mnemos", "Проект «Красноярский лев», документ «README.md».", { workContext: { projectName: "Красноярский лев", resourceName: "README.md" } }),
    ] },
  ];
}

describe("старые беседы читаются прилично", () => {
  it("код-носитель скрыт, шаги названы по делу, проект по имени, идентификатора нет", () => {
    const { steps, code } = buildWorkSteps(lionBatches());
    expect(code).toHaveLength(2);
    const labels = steps.map(step => step.label);
    expect(labels[0]).toBe("Посмотрел папки проекта «Красноярский лев»");
    expect(labels[1]).toBe("Искал «session websocket audio microphone kiosk frontend files» в «Красноярский лев»");
    expect(labels.at(-1)).toBe("Открыл «README.md» в «Красноярский лев»");
    expect(labels.join("\n")).not.toContain(LION);
    expect(labels.join("\n")).not.toMatch(/Выполнил действие|Прочитал Поиск/);
    expect(steps).toHaveLength(11);
  });

  it("девять поисков подряд — одна строка с раскрытием, итог — счётом по видам", () => {
    const { steps, code } = buildWorkSteps(lionBatches());
    const groups = groupSteps(steps);
    expect(groups.map(group => group.label)).toEqual([
      "Посмотрел папки проекта «Красноярский лев»",
      "Искал в «Красноярский лев» 9 раз",
      "Открыл «README.md» в «Красноярский лев»",
    ]);
    expect(groups[1].steps).toHaveLength(9);
    expect(summarizeRun(steps, code.length, 42_000)).toBe("Готово за 42 с · 1 просмотр папок, 9 поисков, 1 документ открыт, 2 запуска кода");
    expect(summarizeRun(steps, code.length, 42_000, true)).toMatch(/^Работаю · /);
  });

  it("имя проекта берётся из списка проектов беседы, если итога чтения нет", () => {
    const { steps } = buildWorkSteps([{ calls: [], observations: [observation("Поиск в Mnemos", `Проект «${LION}», запрос: «лев».`)] }], { projectNames: new Map([[LION, "Красноярский лев"]]) });
    expect(steps[0].label).toBe("Искал «лев» в «Красноярский лев»");
    const unnamed = buildWorkSteps([{ calls: [], observations: [observation("Папки проекта Mnemos", `Проект «${LION}», папка «корень».`)] }]);
    expect(unnamed.steps[0].label).toBe("Посмотрел папки проекта —");
  });
});

// ---- новые записи: activity с итогом ----

describe("новые беседы: итог чтения в раскрытии", () => {
  it("поиск показывает число совпадений и найденные документы со ссылками", () => {
    const { steps } = buildWorkSteps([{ calls: [call("executeCode", { code: "await env.MNEMOS.searchProject(p, 'лев')" })], observations: [
      observation("Поиск в Mnemos", "Проект «Красноярский лев», запрос: «лев».", { activity: { kind: "mnemos.search", ref: "r1", scope: "Красноярский лев", scopeId: LION, subject: "лев" } }),
      observation("Материалы Mnemos", "Поиск выполнен в проекте «Красноярский лев».", { workContext: { projectName: "Красноярский лев" }, activity: { kind: "mnemos.result", ref: "r1", total: 8, items: [
        { name: "main.py", path: "бэкенд/app/main.py", snippet: "app = FastAPI()", projectId: LION, documentId: "n1" },
      ] } }),
    ] }]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ label: "Искал «лев» в «Красноярский лев»", meta: "8 совпадений" });
    expect(steps[0].detail).toMatchObject({ type: "found", total: 8, items: [{ name: "main.py", path: "бэкенд/app/main.py", snippet: "app = FastAPI()", link: { project: LION, document: "n1", resourceTitle: "Mnemos" } }] });
  });

  it("сведения и подготовка действия названы по виду", () => {
    const { steps } = buildWorkSteps([{ calls: [], observations: [
      observation("Сведения Mnemos", "Чтение: расходы.", { activity: { kind: "mnemos.info.spending", subject: "расходы" } }),
      observation("Сведения Mnemos", "Чтение: права сотрудника."),
      observation("Подготовка действия Mnemos", "Поделиться документом: проверка и описание для подтверждения."),
    ] }]);
    expect(steps.map(step => step.label)).toEqual(["Посмотрел расходы", "Посмотрел права сотрудника", "Подготовил действие «Поделиться документом»"]);
  });

  it("внешнее подключение: осмысленный запасной вид, а не «Выполнил действие»", () => {
    const { steps } = buildWorkSteps([{ calls: [], observations: [
      { chatId: 1, sequence: 900, resourceTitle: "Почта", title: "Прочитать письмо", description: "Письмо от **Ольги**" },
      { chatId: 1, sequence: 901, resourceTitle: "GitHub MCP", title: "GitHub: list tools", description: "Read the tool catalog of the MCP server **GitHub**" },
    ] }]);
    expect(steps.map(step => step.label)).toEqual(["Получил данные из «Почта»: Прочитать письмо", "Посмотрел инструменты «GitHub»"]);
  });
});

describe("идущий шаг", () => {
  it("настоящее время по методу в коде, по файлу — с именем", () => {
    expect(describeLiveStep("executeCode", undefined, "await env.MNEMOS.searchProject(p, 'x')")).toBe("Ищу");
    expect(describeLiveStep("executeCode", undefined, "await env.MNEMOS.readDocument(p, 'x')")).toBe("Открываю");
    expect(describeLiveStep("readFile", "README.md", "")).toBe("Читаю README.md");
    expect(describeLiveStep(null, undefined, undefined)).toBe("Готовлю шаг");
  });

  it("длительность по-человечески", () => {
    expect(formatDuration(42_000)).toBe("42 с");
    expect(formatDuration(185_000)).toBe("3 мин 5 с");
  });
});

// ---- беседа «Устройство льва» в рабочем месте с документом «Коммерческое предложение для АТБанк» ----

describe("шаги кода с гаджетом беседы", () => {
  const read = call("executeCode", { code: "const doc = await env.ATBANK_PROPOSAL.getDocument();\nreturn doc.blocks.length" }, { output: "12" });
  const write = call("executeCode", { code: "await env.ATBANK_PROPOSAL.setDocument({title: 'КП', blocks: [{id: 'b1', html: '<h1>Коммерческое предложение</h1>'}, {id: 'b2', html: '<p>Срок поставки — 15 октября.</p>'}]})" });
  const gadget = { title: "Коммерческое предложение для АТБанк", bindingName: "ATBANK_PROPOSAL", outputId: "document" };

  it("по методу привязки: прочитал и изменил документ по заголовку, а не по имени привязки", () => {
    const { steps } = buildWorkSteps([{ calls: [read], observations: [], gadgets: [gadget] }, { calls: [write], observations: [], gadgets: [gadget] }]);
    expect(steps.map(step => step.label)).toEqual([
      "Прочитал документ «Коммерческое предложение для АТБанк»",
      "Изменил документ «Коммерческое предложение для АТБанк»",
    ]);
    expect(steps.map(step => step.label).join()).not.toMatch(/ATBANK_PROPOSAL|Запустил код/);
    expect(steps[1].detail).toMatchObject({ type: "code", lines: ["Коммерческое предложение", "Срок поставки — 15 октября."] });
  });

  it("старая запись без списка гаджетов: заголовок — единственного документа рабочего места", () => {
    const { steps } = buildWorkSteps([{ calls: [read], observations: [] }], { workspaceGadgets: [gadget, { title: "Смета", outputId: "spreadsheet" }] });
    expect(steps[0].label).toBe("Прочитал документ «Коммерческое предложение для АТБанк»");
    const unknown = buildWorkSteps([{ calls: [read], observations: [] }]);
    expect(unknown.steps[0].label).toBe("Прочитал документ");
  });

  it("таблица и презентация — свои глаголы; приложение — «Обратился к приложению»", () => {
    const sheet = call("executeCode", { code: "await env.SHEET.applyOperation({structure: {sheetOrder: []}, sheetReplacements: []})" });
    const deck = call("executeCode", { code: "await env.DECK.mutateDocument(3, 'setDeck', [deck])" });
    const app = call("executeCode", { code: "await env.CRM.addLead({name: 'x'})" });
    const { steps } = buildWorkSteps([{ calls: [sheet, deck, app], observations: [], gadgets: [{ title: "Смета", bindingName: "SHEET", outputId: "spreadsheet" }, { title: "Питч", bindingName: "DECK", outputId: "presentation" }, { title: "CRM", bindingName: "CRM" }] }]);
    expect(steps.map(step => step.label)).toEqual(["Изменил таблицу «Смета»", "Изменил презентацию «Питч»", "Обратился к приложению «CRM»"]);
  });

  it("четыре обращения к документу подряд — одна строка, ход сводится в итог", () => {
    const batches = [read, write, read, write].map(c => ({ calls: [{ ...c, toolCallId: Math.random().toString() } as AiToolCall], observations: [], gadgets: [gadget] }));
    const { steps, code } = buildWorkSteps(batches);
    const groups = groupSteps(steps);
    expect(groups).toHaveLength(4);
    expect(summarizeRun(steps, code.length, 30_000)).toBe("Готово за 30 с · 2 чтения документа, 2 правки документа");
    const reads = groupSteps(buildWorkSteps([read, read].map(c => ({ calls: [{ ...c, toolCallId: Math.random().toString() } as AiToolCall], observations: [], gadgets: [gadget] }))).steps);
    expect(reads.map(group => group.label)).toEqual(["Прочитал документ «Коммерческое предложение для АТБанк» · 2 раза"]);
  });

  it("идущий шаг с гаджетом", () => {
    expect(describeLiveStep("executeCode", undefined, "await env.ATBANK_PROPOSAL.setDocument({})")).toBe("Меняю документ");
  });
});
