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

  it("порядок работы: найти по всем проектам, прочитать окнами, изменить, опубликовать, вести трекер", () => {
    const text = formatMnemosWorkPrompt("MNEMOS");
    for (const method of ["search(", "searchProject", "browseProject", "readDocument", "createDraft", "saveDraft", "publishDraft", "readTracker", "changeTrackerTask", "listPersonalDocuments", "proposeCreateProject"]) {
      expect(text).toContain(`${method}`);
    }
    expect(text).toContain("env.MNEMOS.search(");
    expect(text).toContain("doc.text.slice(0, 20000)");
    expect(text).toContain("{ordinal, radius}");
    expect(text).toContain("не называй их опубликованными");
    // Прежние оговорки сняты: публикация и трекер теперь доступны.
    expect(text).not.toContain("пока нельзя");
    expect(text).not.toContain("не пиши, что документ уже опубликован");
  });

  it("чувствительные действия: только предложение карточкой, карточку не пересказывать, без подтверждения — никак", () => {
    const text = formatMnemosWorkPrompt("MNEMOS");
    for (const method of ["shareDocument", "requestReview", "decideReview", "decideAccessRequest", "actionStatus", "documentAccess", "listReviews"]) {
      expect(text).toContain(method);
    }
    expect(text).toContain("awaiting_confirmation");
    expect(text).toContain("Не пересказывай карточку");
    expect(text).toContain("Без подтверждения чувствительное не выполняется");
    for (const method of ["updateOrgRules", "setReviewDomain", "decideIntake", "setAgentSourceAccess", "disableConnection", "linkRepository", "openScreen"]) {
      expect(text).toContain(method);
    }
    expect(text).toContain("Не проси у человека пароли");
  });
});
