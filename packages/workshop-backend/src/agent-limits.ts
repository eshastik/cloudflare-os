// Пределы хода агента беседы: число шагов и объём того, что инструмент отдаёт модели за раз.
//
// Шаг — один запрос к модели с исполнением её вызовов инструментов. На пределе агент не
// обрывается молча: последний шаг получает указание подвести итог, а в беседе остаётся отметка
// с кнопкой «Продолжить» (код AGENT_STEP_LIMIT_CODE).
//
// Большой файл или вывод отдаётся частями, и в конце части модель видит, где продолжение:
// обрезка без пометки заставила бы её рассуждать о документе, которого она не видела целиком.

import { AGENT_STEP_LIMIT_CODE } from "@gadgets/workshop-shared/api";

export const AGENT_STEP_LIMIT = 100;

// Считает завершённые шаги хода. Предел проверяется после каждого шага.
export class StepBudget {
  #completed = 0;

  constructor(readonly limit: number = AGENT_STEP_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Предел шагов должен быть не меньше 1.");
  }

  get completed(): number { return this.#completed; }

  // Отмечает завершённый шаг. Возвращает true, если следующий шаг — последний разрешённый.
  finishStep(): boolean {
    this.#completed++;
    return this.#completed === this.limit - 1;
  }

  get exhausted(): boolean { return this.#completed >= this.limit; }
}

// Добавка к системной подсказке на последнем шаге: вызовы инструментов модель ещё может
// сделать, но их результат уже не увидит, поэтому просим итог словами.
export function finalStepInstruction(limit: number): string {
  return [
    "# Последний шаг этого хода",
    "",
    `Это последний, ${limit}-й шаг текущего хода. Не вызывай инструменты: их результат ты уже не увидишь.`,
    "Кратко напиши человеку по-русски:",
    "1. Что уже сделано (по пунктам, с названиями документов и проектов).",
    "2. Что осталось сделать.",
    "Закончи фразой, что для продолжения достаточно нажать «Продолжить».",
  ].join("\n");
}

// Хук цикла агента (prepareNextTurn): считает шаг и на последнем шаге добавляет к системной
// подсказке просьбу подвести итог. Остановку по пределу даёт shouldStopAfterTurn через
// budget.exhausted: pi вызывает prepareNextTurn раньше него, поэтому счёт уже обновлён.
export function stepLimitPrepareNextTurn<C extends {systemPrompt?: string}>(
    budget: StepBudget, summarize: boolean) {
  return ({context}: {context: C}): {context: C} | undefined => {
    let lastStepNext = budget.finishStep();
    if (!lastStepNext || !summarize) return undefined;
    return {context: {
      ...context,
      systemPrompt: `${context.systemPrompt ?? ""}\n\n${finalStepInstruction(budget.limit)}`,
    }};
  };
}

// Отметка в беседе, когда ход упёрся в предел.
export function stepLimitNotice(limit: number): string {
  return `Агент сделал ${limit} шагов и остановился. Нажмите «Продолжить», чтобы он доделал работу.`;
}

// «Продолжить» разрешено, только если беседа кончается отметкой о пределе шагов: иначе кнопка
// стала бы вторым способом запустить агента без сообщения человека.
export function canContinueAfterStepLimit(last: {type: string; code?: string} | undefined): boolean {
  return last?.type === "error" && last.code === AGENT_STEP_LIMIT_CODE;
}

// Сообщение агенту при нажатии «Продолжить»: продолжить с места остановки, не начиная заново.
export const CONTINUE_AFTER_STEP_LIMIT_TEXT =
  "Продолжай работу с того места, где остановился. Не повторяй уже сделанное; " +
  "если всё готово, кратко скажи об этом.";

// ---------------------------------------------------------------------------------------------
// Чтение частями.

// Сколько строк и символов readFile отдаёт за один вызов.
export const READ_PAGE_LINES = 2000;
export const READ_PAGE_CHARS = 100_000;

// Сколько символов вывода executeCode и тела webFetch модель видит за один вызов.
export const TOOL_OUTPUT_PAGE_CHARS = 100_000;

// Возвращает часть файла по строкам. Файл, который целиком помещается в одну часть и читается
// без offset/limit, отдаётся как есть — без пометок, чтобы editFile сверялся с точным текстом.
// Иначе в конце части стоит пометка: какие строки показаны и с какого offset читать дальше.
export function pageFileText(text: string, offset?: number, limit?: number): string {
  let lines = text.split("\n");
  let total = lines.length;
  let paged = offset !== undefined || limit !== undefined;
  if (!paged && total <= READ_PAGE_LINES && text.length <= READ_PAGE_CHARS) return text;

  let start = Math.max(1, Math.floor(offset ?? 1));
  let count = Math.max(1, Math.min(Math.floor(limit ?? READ_PAGE_LINES), READ_PAGE_LINES));
  if (start > total) {
    return `[В файле ${total} строк; строки с ${start} нет. Читай с offset от 1 до ${total}.]`;
  }

  let picked: string[] = [];
  let chars = 0;
  let cutInsideLine = false;
  for (let i = start - 1; i < Math.min(total, start - 1 + count); i++) {
    let line = lines[i];
    if (chars + line.length + 1 > READ_PAGE_CHARS) {
      if (picked.length === 0) {
        // Одна строка длиннее части: отдаём её начало и честно говорим об этом.
        picked.push(line.slice(0, READ_PAGE_CHARS));
        cutInsideLine = true;
      }
      break;
    }
    picked.push(line);
    chars += line.length + 1;
  }

  let end = start + picked.length - 1;
  let note = end < total
    ? `[Показаны строки ${start}–${end} из ${total}. Продолжение: readFile с offset=${end + 1}.]`
    : `[Показаны строки ${start}–${end} из ${total}. Это конец файла.]`;
  if (cutInsideLine) {
    note = `[Строка ${start} длиннее ${READ_PAGE_CHARS} символов, показано её начало. ` +
      (end < total ? `Следующая строка: offset=${end + 1}.]` : "Это конец файла.]");
  }
  return `${picked.join("\n")}\n\n${note}`;
}

// Ограничивает вывод executeCode. Код нельзя перезапустить «со следующей страницы», поэтому
// пометка подсказывает модели, как вывести следующую часть самой.
export function limitCodeOutput(output: string, limit: number = TOOL_OUTPUT_PAGE_CHARS): string {
  if (output.length <= limit) return output;
  return `${output.slice(0, limit)}\n\n[Вывод обрезан: показаны первые ${limit} из ${output.length} ` +
    `символов. Остальное ты не видел. Чтобы прочитать дальше, выведи следующую часть, например ` +
    `console.log(text.slice(${limit}, ${limit * 2})), или выведи только нужные поля.]`;
}

// Возвращает часть тела ответа webFetch по символам, с пометкой о продолжении.
export function pageWebBody(body: string, offset?: number, limit: number = TOOL_OUTPUT_PAGE_CHARS)
    : {body: string; note?: string} {
  let start = Math.max(0, Math.floor(offset ?? 0));
  if (start === 0 && body.length <= limit) return {body};
  if (start >= body.length) {
    return {body: "", note: `[В ответе ${body.length} символов; с позиции ${start} ничего нет.]`};
  }
  let end = Math.min(body.length, start + limit);
  let note = end < body.length
    ? `[Показаны символы ${start}–${end} из ${body.length}. Продолжение: webFetch с тем же url и offset=${end}.]`
    : `[Показаны символы ${start}–${end} из ${body.length}. Это конец ответа.]`;
  return {body: body.slice(start, end), note};
}
