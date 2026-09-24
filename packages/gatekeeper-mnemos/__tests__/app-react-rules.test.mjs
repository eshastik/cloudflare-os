import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Правила»: правила организации на одной странице, выбором и переключателями; сохраняются одним действием", async () => {
  const saved = [];
  const app = await mountMemoryApp({ async updateProjectSharingSettings(settings) { saved.push(settings); } }, { section: "rules" });
  try {
    await app.until(() => app.document.querySelector('select[aria-label="Кто создаёт проекты"]'), "правила");
    assert.ok(app.document.querySelector('input[role="switch"]'), "личные проекты — переключателем");
    assert.ok(app.text().includes("Согласования"), "про согласования сказано, где они задаются");
    app.type(app.document.querySelector('select[aria-label="Кто создаёт проекты"]'), "heads");
    app.button("Сохранить правила").click();
    await app.until(() => app.text().includes("Правила сохранены."), "сохранено");
    assert.equal(saved[0].project_create_by, "heads");
  } finally { app.dispose(); }
});
