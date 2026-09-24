import { test } from "node:test";
import assert from "node:assert/strict";
import { SpeedMeter, bytesOf, bytesText, etaText, filesCount, groupDigits, paceLine, progressLine, skippedLine, uploadPercent, type UploadView } from "./upload-progress.ts";

const MB = 1024 * 1024;

test("процент считается по байтам, а не по числу файлов", () => {
  // Почти все мелкие файлы готовы, крупный ещё идёт: по файлам 98 %, по байтам 50 %.
  assert.equal(uploadPercent({ files: 3670, doneFiles: 3600, bytes: 400 * MB, doneBytes: 200 * MB }), 50);
  assert.equal(uploadPercent({ files: 3670, doneFiles: 1240, bytes: 407 * MB, doneBytes: 138 * MB }), 33);
  // Только пустые файлы — по числу файлов; не выше 100.
  assert.equal(uploadPercent({ files: 4, doneFiles: 1, bytes: 0, doneBytes: 0 }), 25);
  assert.equal(uploadPercent({ files: 1, doneFiles: 1, bytes: 10, doneBytes: 11 }), 100);
});

test("подписи: разряды, байты в одной единице, скорость и остаток", () => {
  assert.equal(groupDigits(14158), "14 158");
  assert.equal(filesCount(3670), "3 670 файлов");
  assert.equal(filesCount(1), "1 файл");
  assert.equal(filesCount(22), "22 файла");
  assert.equal(bytesOf(138 * MB, 407 * MB), "138 из 407 МБ");
  assert.equal(bytesOf(0.5 * MB, 2 * MB), "0,5 из 2 МБ");
  assert.equal(bytesOf(300 * MB, 1.5 * 1024 * MB), "0,3 из 1,5 ГБ");
  assert.equal(bytesText(407 * MB), "407 МБ");
  assert.equal(etaText(null), "");
  assert.equal(etaText(42), "осталось меньше минуты");
  assert.equal(etaText(185), "осталось ≈ 3 мин");
  assert.equal(etaText(4800), "осталось ≈ 1 ч 20 мин");
  const view: Extract<UploadView, { phase: "uploading" }> = { phase: "uploading", id: 1, project: "p", folder: "Лев", files: 3670, bytes: 407 * MB, doneFiles: 1240, doneBytes: 138 * MB, failed: 0, current: "", speed: 2.4 * MB, eta: 180, stopping: false };
  assert.equal(progressLine(view), "1 240 из 3 670 файлов · 138 из 407 МБ");
  assert.equal(paceLine(view), "2,4 МБ/с · осталось ≈ 3 мин");
  assert.equal(paceLine({ ...view, speed: 0, eta: null }), "");
});

test("пропуск: число и первые причины, многоточие при остатке", () => {
  const view: Extract<UploadView, { phase: "confirm" }> = {
    phase: "confirm", id: 1, project: "p", folder: "Лев", files: 3670, bytes: 407 * MB, skipped: 14158, skippedMore: false,
    groups: [".venv", ".git", "__pycache__", "по .gitignore", "node_modules", "*.pyc"].map((label, i) => ({ label, files: 100 - i })),
  };
  assert.equal(skippedLine(view), "Пропущено 14 158 служебных: .venv, .git, __pycache__, по .gitignore…");
  assert.equal(skippedLine({ ...view, skipped: 1, groups: [{ label: ".DS_Store", files: 1 }] }), "Пропущено 1 служебный: .DS_Store");
  assert.equal(skippedLine({ ...view, skippedMore: true, groups: view.groups.slice(0, 2) }), "Пропущено не меньше 14 158 служебных: .venv, .git");
});

test("скорость сглаживается: один быстрый файл не подбрасывает её до своего мгновенного значения", () => {
  const meter = new SpeedMeter(4000, 1500);
  meter.sample(0, 0);
  // Ровно 1 МБ/с десять секунд.
  for (let t = 1; t <= 10; t++) meter.sample(t * MB, t * 1000);
  assert.ok(Math.abs(meter.sample(10 * MB, 10_000) - MB) < 1);
  // За 200 мс пришло 2 МБ — мгновенно 10 МБ/с; сглаженная скорость растёт, но далеко не до 10.
  const after = meter.sample(12 * MB, 10_200);
  assert.ok(after > MB && after < 2 * MB, `сглажено: ${after / MB} МБ/с`);
  assert.ok(Math.abs((meter.eta(100 * MB, 10_200) ?? 0) - 100 * MB / after) < 1e-6);
});

test("остаток времени не показывается, пока замеров мало", () => {
  const meter = new SpeedMeter(4000, 1500);
  meter.sample(0, 0);
  meter.sample(MB, 1000);
  assert.equal(meter.eta(10 * MB, 1000), null);
  meter.sample(2 * MB, 2000);
  assert.equal(Math.round(meter.eta(8 * MB, 2000)!), 8);
});
