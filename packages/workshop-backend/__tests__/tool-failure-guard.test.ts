import { describe, it, expect } from "vitest";
import { guardToolRepeats, RepeatedFailureGuard } from "../src/tool-failure-guard";

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

describe("повторы упавшего вызова", () => {
  it("после двух одинаковых ошибок подряд третий такой же вызов не выполняется", async () => {
    let runs = 0;
    const notes = new Map<string, string>();
    const guard = new RepeatedFailureGuard();
    const [tool] = guardToolRepeats([{
      name: "codeWork",
      execute: async () => { runs++; throw new Error("Проект «Mnemos» не найден."); },
    }], guard, errorText, (id, text) => notes.set(id, text));
    const args = { task: "найди конфиг", projectId: "mnemos" };

    await expect(tool.execute("c1", args)).rejects.toThrow("Проект «Mnemos» не найден.");
    expect(notes.has("c1")).toBe(false);
    const second = await tool.execute("c2", { projectId: "mnemos", task: "найди конфиг" }).catch((e: Error) => e.message);
    expect(second).toContain("2 раза подряд");
    expect(notes.get("c2")).toBe(second);
    const third = await tool.execute("c3", args).catch((e: Error) => e.message);
    expect(third).toContain("Повтор не выполнен");
    expect(third).toContain("Не выдавай общие знания за результат проверки");
    expect(runs).toBe(2);
    expect(guard.refusals).toBe(1);
  });

  it("другие аргументы, другая ошибка или успех сбрасывают счёт", async () => {
    let fail = true;
    let message = "сеть недоступна";
    const guard = new RepeatedFailureGuard();
    const [tool] = guardToolRepeats([{
      name: "executeCode",
      execute: async (_id: string, p: { code: string }) => { if (fail) throw new Error(message); return p.code; },
    }], guard, errorText);

    await tool.execute("a", { code: "x" }).catch(() => {});
    await expect(tool.execute("b", { code: "y" })).rejects.toThrow(/^сеть недоступна$/);
    message = "нет прав";
    await expect(tool.execute("c", { code: "x" })).rejects.toThrow(/^нет прав$/);
    fail = false;
    expect(await tool.execute("d", { code: "x" })).toBe("x");
    fail = true;
    await expect(tool.execute("e", { code: "x" })).rejects.toThrow(/^нет прав$/);
    expect(guard.refusals).toBe(0);
  });
});
