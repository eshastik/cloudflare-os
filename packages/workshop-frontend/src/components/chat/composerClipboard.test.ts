// @vitest-environment jsdom
import { expect, test } from "vitest";
import { composerClipboardText } from "./composerClipboard";

test("список из Google Docs сохраняет пункты, вложенность и выделение", () => {
  const html = '<b style="font-weight:normal"><h2>План</h2><ul><li><span style="font-weight:700">Первое</span><ul><li>Подпункт</li></ul></li><li>Второе</li></ul></b>';
  const text = composerClipboardText("План\nПервое\nПодпункт\nВторое", html);
  expect(text).toContain("## План");
  expect(text).toMatch(/^- +\*\*Первое\*\*/m);
  expect(text).toMatch(/^ +- +Подпункт/m);
  expect(text).toMatch(/^- +Второе/m);
  expect(text.startsWith("**")).toBe(false);
});

test("нумерованный список сохраняет начальный номер", () => {
  expect(composerClipboardText("Третий\nЧетвёртый", '<ol start="3"><li>Третий</li><li>Четвёртый</li></ol>')).toMatch(/^3\. +Третий\n4\. +Четвёртый$/);
});

test("таблица из Excel остаётся таблицей", () => {
  const text = composerClipboardText("Товар\tЦена\nКнига\t17", '<table><tr><td>Товар</td><td>Цена</td></tr><tr><td>Книга</td><td>17</td></tr></table>');
  expect(text).toMatch(/\| Товар \| Цена \|/);
  expect(text).toMatch(/\| Книга \| 17 \|/);
});

test("текст без форматирования, Markdown и отступы кода не переписываются", () => {
  const text = "- **Пункт**\n\n    const x = 17;\n";
  expect(composerClipboardText(text, `<span style="color:red">${text}</span>`)).toBe(text);
  expect(composerClipboardText(text, "")).toBe(text);
  expect(composerClipboardText("    • Буквальный текст", "")).toBe("    • Буквальный текст");
  expect(composerClipboardText("https://example.org", '<a href="https://example.org">https://example.org</a>')).toBe("https://example.org");
});

test("обычные маркеры списка превращаются в список, но остаются буквальными внутри кода", () => {
  expect(composerClipboardText("• Первое\n  ◦ Подпункт\n\n```text\n• Буквальный текст\n```", ""))
    .toBe("- Первое\n  - Подпункт\n\n```text\n• Буквальный текст\n```");
});

test("HTML не исполняется, опасная ссылка не переносится, безопасная сохраняется", () => {
  const text = composerClipboardText("текст", '<p><strong>текст</strong><a href="javascript:alert(1)">опасная</a><a href="https://example.org/a?q=1">источник</a></p><script>alert(1)</script><img src="https://example.org/tracking" alt="схема">');
  expect(text).not.toContain("javascript:");
  expect(text).not.toContain("alert(1)");
  expect(text).not.toContain("tracking");
  expect(text).toContain("[источник](<https://example.org/a?q=1>)");
  expect(text).toContain("схема");
});
