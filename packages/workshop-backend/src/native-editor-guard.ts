// Запрет агенту беседы править код встроенных редакторов (документ, таблица, презентация).
//
// Подсказки в системном тексте агент нарушал: вместо того чтобы заполнить документ, он
// переписывал код редактора в «генератор», гаджет перезапускался на каждой правке, а документ
// оставался пустым и без привязки к Mnemos. Код таких гаджетов обновляет только платформа
// (см. native-editor-update.ts), поэтому файловые инструменты агента на них отказывают.

import type {BlueprintOutput} from "@gadgets/workshop-shared/api";
import {nativeFormatForOutput, type NativeDocumentFormat} from "@gadgets/workshop-shared/native-document";

function fillHint(format: NativeDocumentFormat, env: string): string {
  switch (format) {
    case "cloudflareos.document":
      return `\`${env}.setDocument({title, blocks: [{id: "b1", html: "<h1>…</h1>"}, {id: "b2", html: "<p>…</p>"}]})\`` +
          ` (блок — один элемент верхнего уровня: h1–h3, p, ul/ol, table, blockquote)`;
    case "cloudflareos.spreadsheet":
      return `\`${env}.getDocument()\` за id листа, затем \`${env}.applyOperation({structure: {title, sheetOrder, sheets}, ` +
          `sheetReplacements: [{sheetId, cells: {A1: {value: "…", fmt: null, version: 1}}}]})\``;
    case "cloudflareos.presentation":
      return `\`${env}.getDocument()\`, затем \`${env}.mutateDocument(revision, "setDeck", [{...deck, title, slides}])\``;
  }
}

/** Текст отказа файловому инструменту для гаджета встроенного формата; null — код править можно. */
export function nativeEditorCodeLock(output: BlueprintOutput | undefined, envName: string): string | null {
  let format = nativeFormatForOutput(output?.id);
  if (!format) return null;
  let noun = output?.noun || "документ";
  return `Это встроенный редактор (${noun}): его код не меняется агентом, файлы client.js, server.js и ` +
      `другие править нельзя. Содержимое заполняй методами сервера редактора через executeCode: ` +
      `${fillHint(format, `env.${envName}`)}; подробности — в README.md этого гаджета (readFile). ` +
      `Всегда задавай осмысленное название на русском. Нужен ещё один файл — создай новый гаджет из того ` +
      `же формата (createGadget с его blueprintId). Скачивание в Word, Excel или PowerPoint у человека ` +
      `есть в меню скачивания редактора; генераторы файлов не пиши.`;
}
