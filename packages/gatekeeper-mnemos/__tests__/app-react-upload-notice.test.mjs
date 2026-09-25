// Уведомление о загрузке папки: сводка в блоке «Файлы», ход по байтам, остановка, ошибки с повтором,
// плашка в другом разделе. Состояние присылает оболочка (UploadView), фрейм только рисует и просит.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

const MB = 1024 * 1024;
const empty = { async browseProject() { return { nodes: [], truncated: false }; } };
const confirm = {
  phase: "confirm", id: 7, project: "two", folder: "Красноярский лев", files: 3670, bytes: 407 * MB,
  skipped: 14158, skippedMore: false,
  groups: [{ label: ".venv", files: 9812 }, { label: "по .gitignore", files: 2100 }, { label: ".git", files: 1900 }, { label: "__pycache__", files: 300 }, { label: "node_modules", files: 40 }, { label: "*.pyc", files: 6 }],
};
const uploading = (extra = {}) => ({
  phase: "uploading", id: 7, project: "two", folder: "Красноярский лев", files: 3670, bytes: 407 * MB, doneFiles: 1240, doneBytes: 138 * MB,
  failed: 0, current: "Красноярский лев/docs/смета.xlsx", speed: 2.4 * MB, eta: 180, stopping: false, ...extra,
});
const section = app => app.document.querySelector('#root section[aria-label="Файлы"]');
const floating = app => app.document.querySelector("[data-upload-floating]");

test("сводка перед загрузкой: числа, причины пропуска раскрываются, «Загрузить» отвечает оболочке", async () => {
  const app = await mountMemoryApp(empty, { section: "projects", project: "two", uploads: {} });
  try {
    await app.until(() => section(app) && app.calls.some(c => c[0] === "subscribeUploads"), "подписка на загрузку");
    await app.until(() => section(app).textContent.includes("Документов пока нет"), "пустой проект");
    await app.pushUpload(confirm);
    await app.until(() => section(app).querySelector('[data-upload="confirm"]'), "сводка в блоке «Файлы»");
    const card = section(app).querySelector('[data-upload="confirm"]');
    assert.equal(card.querySelector("p").textContent, "Загрузить папку «Красноярский лев»?");
    assert.equal(card.querySelector("[data-upload-total]").textContent, "3 670 файлов · 407 МБ");
    assert.equal(card.querySelector("[data-upload-skipped]").textContent, "Пропущено 14 158 служебных: .venv, по .gitignore, .git, __pycache__…");
    // Сводка не висит над страницей: она внутри блока «Файлы», плашки в углу нет.
    assert.equal(floating(app), null);
    // Пока ждём ответа, «Документов пока нет» не показывается, кнопки выбора заблокированы.
    assert.equal(section(app).textContent.includes("Документов пока нет"), false);
    assert.equal(app.button("Выбрать папку").disabled, true);
    assert.equal(card.querySelector('[aria-label="Причины пропуска"]'), null);
    card.querySelector("[data-upload-skipped]").closest("button").click();
    await app.until(() => card.querySelector('[aria-label="Причины пропуска"]'), "список причин");
    const reasons = [...card.querySelectorAll('[aria-label="Причины пропуска"] li')].map(li => li.textContent);
    assert.deepEqual(reasons, [".venv9 812 файлов", "по .gitignore2 100 файлов", ".git1 900 файлов", "__pycache__300 файлов", "node_modules40 файлов", "*.pyc6 файлов"]);
    app.button("Загрузить").click();
    await app.until(() => app.calls.some(c => c[0] === "answerUpload"), "ответ оболочке");
    assert.deepEqual(app.calls.find(c => c[0] === "answerUpload"), ["answerUpload", 7, "upload"]);
    app.button("Отмена").click();
    await app.until(() => app.calls.some(c => c[0] === "answerUpload" && c[2] === "cancel"), "отмена");
  } finally { app.dispose(); }
});

test("ход по байтам: процент, числа, скорость, текущий файл; «Остановить» просит оболочку", async () => {
  const app = await mountMemoryApp(empty, { section: "projects", project: "two", uploads: { initial: uploading() } });
  try {
    await app.until(() => section(app)?.querySelector('[data-upload="uploading"]'), "ход в блоке «Файлы»");
    const card = () => section(app).querySelector('[data-upload="uploading"]');
    // 138 из 407 МБ — 33 %, хотя по файлам было бы 1240/3670 = 33,8 → проверяем именно байты ниже.
    assert.equal(card().querySelector("[data-upload-percent]").textContent, "33%");
    assert.equal(card().querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), "33");
    assert.equal(card().querySelector("[data-upload-progress]").textContent, "1 240 из 3 670 файлов · 138 из 407 МБ");
    assert.ok(card().textContent.includes("2,4 МБ/с · осталось ≈ 3 мин"));
    assert.equal(card().querySelector("[data-upload-current]").textContent, "Красноярский лев/docs/смета.xlsx");
    assert.equal(section(app).textContent.includes("Документов пока нет"), false);
    // Мелкие файлы кончились, остался крупный: файлов почти все, байт — половина.
    await app.pushUpload(uploading({ doneFiles: 3600, doneBytes: 203.5 * MB, failed: 3 }));
    await app.until(() => card().querySelector("[data-upload-percent]").textContent === "50%", "процент по байтам");
    assert.ok(card().textContent.includes("3 ошибки"));
    app.button("Остановить").click();
    await app.until(() => app.calls.some(c => c[0] === "stopUpload"), "остановка");
    assert.deepEqual(app.calls.find(c => c[0] === "stopUpload"), ["stopUpload", 7]);
    await app.pushUpload(uploading({ stopping: true }));
    await app.until(() => card().textContent.includes("Останавливаем…"), "останавливаем");
    assert.equal(app.button("Остановить").disabled, true);
  } finally { app.dispose(); }
});

test("итог с ошибками: «Показать» раскрывает список, повтор — только упавших; список файлов перечитан", async () => {
  let reads = 0;
  const app = await mountMemoryApp({ ...empty, async listProjects() { reads++; return { projects: [{ id: "one", name: "Общий проект", slug: "shared" }, { id: "two", name: "Второй проект", slug: "second" }] }; } },
    { section: "projects", project: "two", uploads: { initial: uploading() } });
  try {
    await app.until(() => section(app)?.querySelector('[data-upload="uploading"]'), "ход");
    const before = reads;
    await app.pushUpload({ phase: "done", id: 7, project: "two", files: 3670, accepted: 3667, acceptedBytes: 406.6 * MB, failed: ["Красноярский лев/a.pdf", "Красноярский лев/b.pdf", "Красноярский лев/c.pdf"], failedCount: 3, stopped: 0, personal: false, note: "Материалы добавлены в проект." });
    await app.until(() => section(app).querySelector('[data-upload="done"]'), "итог");
    const card = section(app).querySelector('[data-upload="done"]');
    assert.equal(card.querySelector("[data-upload-result]").textContent, "Загружено 3 667 файлов · 407 МБ");
    assert.ok(card.textContent.includes("Не загрузилось 3 файла."));
    assert.equal(card.querySelector('[aria-label="Не загрузились"]'), null);
    app.button("Показать").click();
    await app.until(() => card.querySelector('[aria-label="Не загрузились"]'), "список ошибок");
    assert.deepEqual([...card.querySelectorAll('[aria-label="Не загрузились"] li')].map(li => li.textContent), ["Красноярский лев/a.pdf", "Красноярский лев/b.pdf", "Красноярский лев/c.pdf"]);
    app.button("Повторить 3").click();
    await app.until(() => app.calls.some(c => c[0] === "retryUpload"), "повтор");
    assert.deepEqual(app.calls.find(c => c[0] === "retryUpload"), ["retryUpload", 7]);
    await app.until(() => reads > before, "список файлов перечитан по завершении");
    card.querySelector('button[aria-label="Закрыть"]').click();
    await app.until(() => !section(app).querySelector('[data-upload="done"]'), "итог закрыт крестиком");
    assert.deepEqual(app.calls.find(c => c[0] === "dismissUpload"), ["dismissUpload", 7]);
  } finally { app.dispose(); }
});

test("уведомление переживает смену раздела: плашка в углу, щелчок возвращает к проекту", async () => {
  const app = await mountMemoryApp(empty, { section: "projects", project: "two", uploads: { initial: uploading() } });
  try {
    await app.until(() => section(app)?.querySelector('[data-upload="uploading"]'), "ход на странице проекта");
    app.go("team");
    await app.until(() => floating(app), "плашка в другом разделе");
    assert.equal(section(app), null);
    assert.ok(floating(app).textContent.includes("33%"));
    assert.ok(floating(app).textContent.includes("1 240 из 3 670 файлов · 138 из 407 МБ"));
    assert.equal(floating(app).querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), "33");
    // Ход продолжает приходить и в другом разделе.
    await app.pushUpload(uploading({ doneFiles: 2000, doneBytes: 300 * MB }));
    await app.until(() => floating(app).textContent.includes("73%"), "ход в плашке");
    floating(app).querySelector("button").click();
    await app.until(() => app.calls.some(c => c[0] === "openSection" && c[1] === "projects"), "возврат к проекту");
    assert.deepEqual(app.calls.find(c => c[0] === "openSection" && c[1] === "projects"), ["openSection", "projects", "two"]);
    await app.until(() => section(app)?.querySelector('[data-upload="uploading"]') && !floating(app), "снова в блоке «Файлы»");
  } finally { app.dispose(); }
});

test("итог с отказами политики: «Не приняты» по причинам без красного, объяснение сервера раскрывается, повтор — только для сбоев", async () => {
  const app = await mountMemoryApp(empty, { section: "projects", project: "two", uploads: { initial: uploading() } });
  try {
    await app.until(() => section(app)?.querySelector('[data-upload="uploading"]'), "ход");
    const secret = "файлы .env, ключи и сертификаты не загружаются: в них могут быть пароли и токены";
    const build = "папки сборки и сторонних библиотек (node_modules, vendor, dist, build и подобные) не загружаются";
    await app.pushUpload({ phase: "done", id: 7, project: "two", files: 3670, accepted: 3662, acceptedBytes: 406 * MB, failed: [], failedCount: 0, stopped: 0, personal: false, note: "Материалы добавлены в проект.",
      refused: [{ reason: "secret", label: "секреты", files: 1, examples: [".env"], detail: secret }, { reason: "build", label: "сторонний код", files: 7, examples: ["vendor"], detail: build }] });
    await app.until(() => section(app).querySelector('[data-upload="done"]'), "итог");
    const card = section(app).querySelector('[data-upload="done"]');
    assert.equal(card.querySelector("[data-upload-refused]").textContent, "Не приняты 8: секреты (.env) — 1, сторонний код (vendor) — 7");
    assert.equal(card.querySelector(".text-kumo-danger"), null, "отказ — не ошибка: без красного");
    assert.equal(app.buttons().some(b => b.textContent.startsWith("Повторить")), false, "отказанные файлы не повторяются");
    assert.equal(card.querySelector('[aria-label="Почему не приняты"]'), null);
    card.querySelector("[data-upload-refused]").closest("button").click();
    await app.until(() => card.querySelector('[aria-label="Почему не приняты"]'), "объяснение");
    const reasons = [...card.querySelectorAll('[aria-label="Почему не приняты"] li')].map(li => li.textContent);
    assert.deepEqual(reasons, [`Секреты: 1 файл${secret}`, `Сторонний код: 7 файлов${build}`]);
    // Настоящий сбой рядом с отказами: «Повторить N» считает только сбои.
    await app.pushUpload({ phase: "done", id: 8, project: "two", files: 3670, accepted: 3660, acceptedBytes: 406 * MB, failed: ["Красноярский лев/a.pdf", "Красноярский лев/b.pdf"], failedCount: 2, stopped: 0, personal: false, note: "",
      refused: [{ reason: "build", label: "сторонний код", files: 8, examples: ["vendor", "node_modules"], detail: build }] });
    await app.until(() => app.button("Повторить 2"), "повтор только сбоев");
    assert.equal(section(app).querySelector("[data-upload-refused]").textContent, "Не приняты 8: сторонний код (vendor, node_modules) — 8");
  } finally { app.dispose(); }
});

test("очередь и прерванная загрузка: пока идёт одна, можно начать следующую; после перезагрузки вкладки — «Догрузить остальные»", async () => {
  const app = await mountMemoryApp(empty, { section: "projects", project: "two", uploads: { initial: uploading({ queued: 2 }) } });
  try {
    await app.until(() => section(app)?.querySelector('[data-upload="uploading"]'), "ход");
    assert.equal(section(app).querySelector("[data-upload-queued]").textContent, " · ещё 2 в очереди");
    // Оболочка ставит новую загрузку в очередь: кнопки выбора не блокируются, пока файлы уходят.
    assert.equal(app.button("Выбрать папку").disabled, false);
    await app.pushUpload({ phase: "done", id: 9, project: "two", files: 3, accepted: 2, acceptedBytes: 10, failed: [], failedCount: 0, stopped: 1, personal: false, note: "", refused: [], interrupted: true });
    await app.until(() => section(app).querySelector('[data-upload="done"]'), "итог");
    assert.equal(section(app).querySelector("[data-upload-stopped]").textContent,
      "Загрузка прервана закрытием вкладки: не загружено 1 файл из 3. Выберите ту же папку снова — принятые файлы пропустим.");
    app.button("Догрузить остальные").click();
    await app.until(() => app.calls.some(c => c[0] === "resumeUpload"), "догрузка");
    assert.deepEqual(app.calls.find(c => c[0] === "resumeUpload"), ["resumeUpload", 9]);
  } finally { app.dispose(); }
});
