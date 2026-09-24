// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCodeChanges } from "@gadgets/workshop-shared/api";
import type { AgentStep } from "@gadgets/workshop-shared/code-work";
import { ProjectChips } from "./components/chat/ProjectChips";
import { CodeChangesCard, splitDiff } from "./components/chat/CodeChangesCard";
import { CodeWorkRow } from "./components/chat/CodeWorkRow";
import { chatListState, summarizeAgentSteps, upsertAgentStep } from "./codeWorkSteps";
import { homeProjectFromSearch, projectContextFromProjects } from "./homePrompt";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });
function render(node: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(node));
  return container;
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
function button(view: HTMLElement, text: string): HTMLButtonElement {
  const found = [...view.querySelectorAll("button")].find(b => b.textContent?.includes(text) || b.getAttribute("aria-label")?.includes(text));
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found as HTMLButtonElement;
}

const steps: AgentStep[] = [
  { id: "1", kind: "file", title: "Прочитал файл go.mod", status: "done", resource: { kind: "file", name: "go.mod" } },
  { id: "2", kind: "edit", title: "Изменил файл a.go +2 −1", status: "done", resource: { kind: "file", name: "a.go" } },
  { id: "3", kind: "run", title: "Выполнил команду: тесты", status: "done", detail: "go test ./...", resource: { kind: "command", name: "go test" } },
  { id: "4", kind: "document", title: "Открыл документ Регламент", status: "done", resource: { kind: "document", name: "Регламент" } },
];

describe("шаги агента", () => {
  it("сводка: время, число шагов и к чему обращался, без команд", () => {
    expect(summarizeAgentSteps(steps, 185_000)).toBe("Работал 3 мин · 4 шага · обращался к: 2 файлам, 1 документу");
    expect(summarizeAgentSteps([], 4_000)).toBe("Работал 4 с · 0 шагов");
  });
  it("шаг с тем же id обновляется на месте", () => {
    const next = upsertAgentStep(steps, { ...steps[0], status: "error" });
    expect(next).toHaveLength(4);
    expect(next[0].status).toBe("error");
    expect(upsertAgentStep(steps, { id: "5", kind: "file", title: "x", status: "running" })).toHaveLength(5);
  });
  it("строка работы с кодом раскрывает шаги, подробности команды — по нажатию", () => {
    const view = render(<CodeWorkRow title="Перешёл к работе с кодом проекта «Продажи»" steps={steps} running={false} durationMs={60_000} />);
    expect(view.textContent).toContain("Перешёл к работе с кодом проекта «Продажи»");
    expect(view.textContent).toContain("Работал 1 мин · 4 шага");
    expect(view.querySelector('[data-testid="code-work-steps"]')).toBeNull();
    act(() => button(view, "Перешёл").click());
    expect(view.textContent).toContain("Изменил файл a.go +2 −1");
    expect(view.textContent).not.toContain("go test ./...");
    act(() => button(view, "Выполнил команду").click());
    expect(view.textContent).toContain("go test ./...");
  });
  it("во время работы шаги видны сразу", () => {
    const view = render(<CodeWorkRow title="Работаю с кодом проекта" steps={[]} running />);
    expect(view.textContent).toContain("Готовлю рабочее место…");
  });
  it("«Остановить» есть только у идущего хода и вызывается один раз", async () => {
    const onStop = vi.fn(async () => {});
    const view = render(<CodeWorkRow title="Работаю с кодом проекта" steps={steps} running onStop={onStop} />);
    await act(async () => { button(view, "Остановить").click(); await Promise.resolve(); });
    expect(onStop).toHaveBeenCalledOnce();
    expect(view.textContent).toContain("Останавливаю…");
    expect(button(view, "Останавливаю").disabled).toBe(true);
    act(() => root?.unmount()); container?.remove();
    const done = render(<CodeWorkRow title="Работал с кодом" steps={steps} running={false} onStop={onStop} />);
    expect([...done.querySelectorAll("button")].some(b => b.textContent === "Остановить")).toBe(false);
  });
  it("состояние беседы в списке", () => {
    expect(chatListState({ activeAgent: {} })).toBe("working");
    expect(chatListState({ codeWork: { review: { outcome: "draft" } } })).toBe("review");
    expect(chatListState({ codeWork: { review: { outcome: "awaiting_approval" } } })).toBe("awaiting");
    expect(chatListState({ codeWork: { review: { outcome: "accepted" } } })).toBeNull();
    expect(chatListState({ hasProposedChanges: true })).toBe("proposed");
  });
});

describe("проекты беседы", () => {
  it("пустой набор подсказывает, что проект определится по задаче; «+» добавляет, × убирает", async () => {
    const onChange = vi.fn();
    const load = vi.fn(async () => [
      { accountId: 1, projectId: "sales", title: "Продажи", hasCode: true },
      { accountId: 1, projectId: "stock", title: "Склад", hasCode: false },
    ]);
    const view = render(<ProjectChips projects={[]} onChange={onChange} loadChoices={load} />);
    expect(view.textContent).toContain("Проект определится по задаче");
    act(() => button(view, "Добавить проект").click());
    await flush();
    expect(view.textContent).toContain("есть код");
    act(() => button(view, "Продажи").click());
    expect(onChange).toHaveBeenCalledWith([{ accountId: 1, projectId: "sales", title: "Продажи", pinnedBy: "user", hasCode: true }]);

    const remove = vi.fn();
    const chips = render(<ProjectChips projects={[
      { accountId: 1, projectId: "sales", title: "Продажи", pinnedBy: "user" },
      { accountId: 1, projectId: "stock", title: "Склад", pinnedBy: "agent" },
    ]} onChange={remove} loadChoices={load} />);
    expect(chips.textContent).toContain("Склад");
    expect(chips.querySelector('[aria-label="подключил агент"]')).not.toBeNull();
    act(() => button(chips, "Убрать проект «Продажи»").click());
    expect(remove).toHaveBeenCalledWith([{ accountId: 1, projectId: "stock", title: "Склад", pinnedBy: "agent" }]);
  });
  it("«Начать беседу» со страницы проекта закрепляет проект; набор уходит в новую беседу", () => {
    const context = homeProjectFromSearch({ accountId: 2, projectId: "p", title: " Продажи " });
    expect(context?.projects).toEqual([{ accountId: 2, projectId: "p", title: "Продажи", pinnedBy: "user" }]);
    expect(projectContextFromProjects([])).toBeUndefined();
    expect(projectContextFromProjects(context!.projects!)).toMatchObject({ accountId: 2, projectId: "p", title: "Продажи" });
  });
});

const changes: ChatCodeChanges = {
  projectTitle: "Продажи",
  summary: "Добавил проверку остатков",
  files: [{ path: "a.go", status: "modified", additions: 2, deletions: 1 }],
  diff: "diff --git a/a.go b/a.go\nindex 1..2\n--- a/a.go\n+++ b/a.go\n@@ -1 +1,2 @@\n-a\n+b\n+c",
  truncated: false,
};

describe("«Что изменилось»", () => {
  it("разбор построчных изменений по файлам без служебных строк", () => {
    expect(splitDiff(changes.diff)).toEqual([{ path: "a.go", lines: ["@@ -1 +1,2 @@", "-a", "+b", "+c"] }]);
  });

  for (const [outcome, note, text] of [
    ["accepted", "Принято", "Принято"],
    ["awaiting_approval", "Ждёт согласования у Анна", "Ждёт согласования у Анна"],
    ["no_approver", "Некому согласовать: назначьте ответственного за проект.", "Некому согласовать"],
  ] as const) {
    it(`одна кнопка «Принять» → ${text}`, async () => {
      const accept = vi.fn(async () => ({ outcome, note }));
      const view = render(<CodeChangesCard refreshKey="k" review={{ outcome: "draft" }} load={async () => changes} accept={accept} />);
      await flush();
      expect(view.textContent).toContain("Что изменилось");
      expect(view.textContent).toContain("a.go");
      expect(view.textContent).not.toMatch(/ветк|коммит|слияни|Сохранить в/i);
      act(() => button(view, "Подробнее").click());
      expect(view.textContent).toContain("+b");
      await act(async () => { button(view, "Принять").click(); await Promise.resolve(); });
      await flush();
      expect(accept).toHaveBeenCalledOnce();
      expect(view.querySelector('[role="status"]')?.textContent).toContain(text);
      expect([...view.querySelectorAll("button")].some(b => b.textContent === "Принять")).toBe(false);
    });
  }

  it("«Вернуть как было» — только у принятых изменений с известным запросом", async () => {
    const revert = vi.fn(async () => ({ outcome: "reverted" as const, note: "Возвращено как было." }));
    const draft = render(<CodeChangesCard refreshKey="k" review={{ outcome: "draft" }} load={async () => changes} accept={vi.fn()} revert={revert} />);
    await flush();
    expect(draft.textContent).not.toContain("Вернуть как было");
    act(() => root?.unmount()); container?.remove();
    const view = render(<CodeChangesCard refreshKey="k" review={{ outcome: "accepted", mergeRequest: 7 }} load={async () => changes} accept={vi.fn()} revert={revert} />);
    await flush();
    await act(async () => { button(view, "Вернуть как было").click(); await Promise.resolve(); });
    await flush();
    expect(revert).toHaveBeenCalledOnce();
    expect(view.querySelector('[role="status"]')?.textContent).toContain("Возвращено как было");
  });

  it("отказ показывается словами службы", async () => {
    const view = render(<CodeChangesCard refreshKey="k" load={async () => changes} accept={async () => { throw new Error("Агент изменил результат после вашего просмотра — проверьте снова."); }} />);
    await flush();
    await act(async () => { button(view, "Принять").click(); await Promise.resolve(); });
    await flush();
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("проверьте снова");
  });

  it("без изменений карточки нет", async () => {
    const view = render(<CodeChangesCard refreshKey="k" load={async () => ({ ...changes, files: [], diff: "" })} accept={vi.fn()} />);
    await flush();
    expect(view.textContent).toBe("");
  });

  it("при нескольких репозиториях изменения группируются по имени репозитория, без служебных путей", async () => {
    const multi: ChatCodeChanges = {
      ...changes,
      files: [{ path: "site/a.go", status: "modified", additions: 2, deletions: 1 }, { path: "api/b.ts", status: "added", additions: 5, deletions: 0 }],
      diff: "",
      repositories: [
        { name: "site", files: [{ path: "a.go", status: "modified", additions: 2, deletions: 1 }], diff: changes.diff, truncated: false },
        { name: "api", files: [{ path: "b.ts", status: "added", additions: 5, deletions: 0 }], diff: "diff --git a/b.ts b/b.ts\n@@ -0,0 +1 @@\n+x", truncated: false },
        { name: "docs", files: [], diff: "", truncated: false },
      ],
    };
    const view = render(<CodeChangesCard refreshKey="k" review={{ outcome: "draft" }} load={async () => multi} accept={vi.fn()} />);
    await flush();
    const groups = [...view.querySelectorAll('[data-testid="code-changes-repository"]')];
    expect(groups.map(g => g.firstElementChild?.textContent)).toEqual(["site", "api"]);
    expect(groups[1].textContent).toContain("b.ts");
    expect(groups[1].textContent).not.toContain("api/b.ts");
    expect(view.textContent).not.toMatch(/\.git|ветк|коммит/i);
    expect(view.textContent).not.toContain("docs");
    act(() => button(view, "Подробнее").click());
    expect(view.textContent).toContain("+x");
  });

  it("после «Принять» без новых изменений карточка говорит об этом словами", async () => {
    const view = render(<CodeChangesCard refreshKey="k" review={{ outcome: "accepted" }} load={async () => ({ ...changes, files: [], diff: "" })} accept={vi.fn()} />);
    await flush();
    expect(view.querySelector('[role="status"]')?.textContent).toContain("Принято");
    expect(view.textContent).toContain("Новых изменений после принятия пока нет");
  });
});
