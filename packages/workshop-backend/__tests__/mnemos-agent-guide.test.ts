import { describe, it, expect } from "vitest";
import { findMnemosBinding, formatMnemosWorkPrompt } from "../src/mnemos-agent-guide";

describe("подсказка агенту беседы о Mnemos", () => {
  it("биндинг Mnemos находится по имени или названию, чужие ресурсы не считаются", () => {
    expect(findMnemosBinding([{name: "MAIL", title: "Почта"}, {name: "MNEMOS", title: "Mnemos"}])).toBe("MNEMOS");
    expect(findMnemosBinding([{name: "MNEMOS_2", title: "Память"}])).toBe("MNEMOS_2");
    expect(findMnemosBinding([{name: "LIBRARY", title: "Mnemos"}])).toBe("LIBRARY");
    expect(findMnemosBinding([{name: "MNEMOSYNE", title: "Другое"}])).toBeUndefined();
    expect(findMnemosBinding([])).toBeUndefined();
  });

  it("порядок работы: найти, прочитать частями, создать и изменить сразу; без обещаний публикации", () => {
    const text = formatMnemosWorkPrompt("MNEMOS");
    for (const method of ["searchProject", "readDocument", "createDraft", "saveDraft", "listPersonalDocuments", "proposeCreateProject"]) {
      expect(text).toContain(`${method}`);
    }
    expect(text).toContain("env.MNEMOS.searchProject");
    expect(text).toContain("doc.text.slice(0, 20000)");
    expect(text).toContain("truncated: true");
    expect(text).toContain("не пиши, что документ уже опубликован");
    expect(text).toContain("вести задачи из беседы пока нельзя");
  });
});
