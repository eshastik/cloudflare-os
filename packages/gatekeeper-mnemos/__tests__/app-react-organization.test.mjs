import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const SECTIONS = ["Метрики платформы", "Предупреждения политики", "Ответственные за сигналы", "Журнал операций", "Массовый пересчёт индекса", "Пересчитать профиль проекта", "Проверка поиска", "Оценка ответа"];

test("«Организация»: разделы показаны по полномочиям, отказ сервера виден как есть, при полномочии данные показаны", async () => {
  let allowed = false;
  const app = await mountMemoryApp({
    async readPlatformMetrics() {
      app.calls.push(["readPlatformMetrics"]);
      if (!allowed) throw new Error("forbidden");
      return { shared_publications: 25, authenticated_users_24h: 2, human_logins_24h: 7, recorded_at: "2026-09-12T10:00:00Z" };
    },
    async policyAlerts() { app.calls.push(["policyAlerts"]); throw new Error("forbidden"); },
  });
  try {
    await app.open("Организация");
    const org = app.document.querySelector('#root section[aria-label="Организация"]');
    await app.until(() => org && SECTIONS.every(name => org.textContent.includes(name)), "все разделы наблюдаемости перечислены");
    assert.ok(org.textContent.includes("по вашим текущим полномочиям"), "правило доступа названо");
    assert.ok(!app.calls.some(([m]) => m === "isAdmin"), "isAdmin оболочки не читается");

    app.button("Открыть: Метрики платформы").click();
    await app.until(() => app.text().includes("Метрики недоступны. Проверьте право просмотра"), "отказ сервера показан как есть");
    assert.equal(app.calls.filter(([m]) => m === "readPlatformMetrics").length, 1);
    app.button("К вкладке").click();
    await app.until(() => app.button("Открыть: Предупреждения политики"), "возврат к списку");

    app.button("Открыть: Предупреждения политики").click();
    await app.until(() => app.text().includes("требуется право администратора"), "отказ раздела предупреждений виден");
    assert.equal(app.calls.filter(([m]) => m === "policyAlerts").length, 1);
    app.button("К вкладке").click();

    allowed = true;
    await app.until(() => app.button("Открыть: Метрики платформы"), "список");
    app.button("Открыть: Метрики платформы").click();
    await app.until(() => app.text().includes("Завершённые публикации: 25"), "метрики при полномочии");
    app.button("К вкладке").click();

    await app.until(() => app.document.querySelector('#root select[aria-label="Проект профиля"]'), "выбор проекта для профиля");
    app.type(app.document.querySelector('#root select[aria-label="Проект профиля"]'), "two");
    app.button("Открыть: Пересчитать профиль проекта").click();
    await app.until(() => app.text().includes("Второй проект") && app.button("К вкладке"), "профиль проекта открыт для выбранного проекта");
  } finally { app.dispose(); }
});
