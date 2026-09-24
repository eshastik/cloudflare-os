// Сторожа ревизии интерфейса 24.09.2026: статическая проверка исходников фрейма.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

async function sources() {
  const out = [];
  for (const dir of ["app-react", "app"]) {
    for (const name of await readdir(new URL(`../${dir}/`, import.meta.url))) {
      if (!/\.(ts|tsx)$/.test(name)) continue;
      out.push({ file: `${dir}/${name}`, text: await readFile(new URL(`../${dir}/${name}`, import.meta.url), "utf8") });
    }
  }
  return out;
}

test("нет тега form и кнопок submit: фрейм — песочница без allow-forms, форма там не отправляется", async () => {
  for (const { file, text } of await sources()) {
    assert.doesNotMatch(text, /<form[\s>]/, `${file}: тег form`);
    assert.doesNotMatch(text, /type=["']submit["']|\.type\s*=\s*["']submit["']/, `${file}: кнопка submit`);
    assert.doesNotMatch(text, /createElement\(["']form["']\)|element\(["']form["']\)/, `${file}: форма из DOM`);
    assert.doesNotMatch(text, /onSubmit=/, `${file}: обработчик отправки формы`);
  }
});

test("один раздел — одна страница: нет подэкранов «Открыть → Назад» и прежних DOM-экранов", async () => {
  for (const { file, text } of await sources()) {
    assert.doesNotMatch(text, /useLegacySection|LegacySwitch|LegacyPanel|openLegacySection|legacy\.open\(|mountLegacy/, `${file}: подэкран прежнего раздела`);
    assert.doesNotMatch(text, />\s*Назад\s*</, `${file}: кнопка «Назад» внутри раздела`);
    assert.doesNotMatch(text, />\s*(К сотрудникам|К материалам|К списку автора)\s*</, `${file}: переход назад внутри раздела`);
  }
});

test("нет полей для ввода идентификаторов на экранах", async () => {
  for (const { file, text } of await sources()) {
    assert.doesNotMatch(text, /aria-label=["'][^"']*(ID |идентификатор|Идентификатор|подключение агента|Версия источника)[^"']*["']/, `${file}: поле идентификатора`);
  }
});
