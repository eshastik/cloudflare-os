import { expect, test } from "vitest";
import { attachmentAppearance } from "./attachmentAppearance";

test("Неизвестное расширение из имени файла не подменяет значок свойством Object", () => {
  for (const name of ["report.constructor", "report.__proto__", "report.toString", "без расширения"]) {
    const appearance = attachmentAppearance(name, "application/octet-stream");
    expect(appearance.label).toBe("Файл");
    expect(appearance.icon).toBeDefined();
  }
  expect(attachmentAppearance("отчёт.DOCX", "application/zip").label).toBe("Документ");
  expect(attachmentAppearance(undefined, "application/pdf").label).toBe("PDF");
});
