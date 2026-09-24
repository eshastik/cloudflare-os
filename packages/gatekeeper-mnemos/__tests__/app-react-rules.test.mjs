import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Правила»: правила организации на одной странице, сегментами и переключателем; изменение сохраняется сразу", async () => {
  const saved = [];
  const app = await mountMemoryApp({ async updateProjectSharingSettings(settings) { saved.push(settings); } }, { section: "rules" });
  try {
    const group = label => app.document.querySelector(`[role="radiogroup"][aria-label="${label}"]`);
    await app.until(() => group("Кто создаёт проекты"), "правила");
    assert.equal(app.document.querySelector("#root select"), null, "раскрывающихся списков нет");
    assert.ok(app.document.querySelector('[role="switch"]'), "личные проекты — переключателем");
    assert.ok(app.text().includes("Согласования"), "про согласования сказано, где они задаются");
    [...group("Кто создаёт проекты").querySelectorAll('[role="radio"]')].find(b => b.textContent === "Руководители").click();
    await app.until(() => app.text().includes("Сохранено."), "сохранено");
    assert.equal(saved[0].project_create_by, "heads");
    assert.equal([...group("Кто создаёт проекты").querySelectorAll('[aria-checked="true"]')].map(b => b.textContent).join(), "Руководители");
  } finally { app.dispose(); }
});

test("«Правила»: отказ сервера возвращает выбор к сохранённому", async () => {
  const app = await mountMemoryApp({ async updateProjectSharingSettings() { throw new Error("403"); } }, { section: "rules" });
  try {
    const group = () => app.document.querySelector('[role="radiogroup"][aria-label="Кто видит новый проект"]');
    await app.until(() => group(), "правила");
    [...group().querySelectorAll('[role="radio"]')].find(b => b.textContent === "Всем").click();
    await app.until(() => app.text().includes("Не сохранилось."), "отказ показан");
    assert.equal(group().querySelector('[aria-checked="true"]').textContent, "Создателю");
  } finally { app.dispose(); }
});
