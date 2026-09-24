// Привязка встроенного редактора (документ, таблица, презентация) к документу Mnemos.
//
// Привязка хранится в записи гаджета на сервере, а не во вкладке браузера: иначе каждая новая
// вкладка или устройство считала бы документ непривязанным и создавала бы в Mnemos второй
// документ. Привязка своя у каждого человека — сохранение идёт в его личный черновик.
//
// Создание документа в Mnemos идёт из браузера человека (только у него есть право записи в его
// черновик), поэтому сервер лишь выдаёт захват: создание ведёт одна вкладка. Квитанция
// замороженной заявки записывается сюда до отправки; вкладка, открытая после сбоя, повторяет
// ту же заявку, и Mnemos возвращает уже созданный документ, а не второй.

import {chatProjects} from "@gadgets/workshop-shared/code-work";
import type {NativeMnemosBinding, NativeMnemosCreation, NativeMnemosState} from "@gadgets/workshop-shared/native-document";

/** Захват без квитанции: вкладка упала до отправки заявки, ничего не создано — можно захватить заново. */
export const MNEMOS_CLAIM_TTL_MS = 2 * 60_000;
/** Захват с квитанцией: заявку повторяет любая вкладка; заново захватывается, только если повторы не проходят долго. */
export const MNEMOS_RECEIPT_TTL_MS = 30 * 60_000;

export type MnemosDocumentEntry = {binding?: NativeMnemosBinding; creation?: NativeMnemosCreation};

const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;

export function validateMnemosBinding(value: unknown): NativeMnemosBinding {
  let v = value as Partial<NativeMnemosBinding> | null;
  if (!v || typeof v !== "object" || !text(v.scope, 255) || !text(v.resource, 255) ||
      !(v.accountId === null || Number.isSafeInteger(v.accountId)) ||
      !(v.savedRevision === undefined || (Number.isSafeInteger(v.savedRevision) && v.savedRevision! >= 0)) ||
      !(v.savedHead === undefined || (typeof v.savedHead === "string" && /^[a-f0-9]{64}$/.test(v.savedHead)))) {
    throw new Error("Invalid document binding.");
  }
  return {accountId: v.accountId!, scope: v.scope!, resource: v.resource!,
    ...(v.savedRevision !== undefined ? {savedRevision: v.savedRevision} : {}),
    ...(v.savedHead !== undefined ? {savedHead: v.savedHead} : {})};
}

function stale(creation: NativeMnemosCreation, now: number) {
  return now - creation.at > (creation.receipt ? MNEMOS_RECEIPT_TTL_MS : MNEMOS_CLAIM_TTL_MS) || creation.at > now;
}

/** Захват создания. null — документ уже привязан или создание ведёт другая вкладка.
 *  holder — метка загрузки вкладки: свой захват без квитанции вкладка перехватывает сразу, не дожидаясь
 *  срока. Иначе вкладка, у которой создание упало, пока освобождение не дошло, блокировала бы саму себя. */
export function claimMnemosCreation(entry: MnemosDocumentEntry, accountId: number, scope: string, name: string,
    now: number, claim: string, holder?: string): {entry: MnemosDocumentEntry; creation: NativeMnemosCreation | null} {
  if (!Number.isSafeInteger(accountId) || !text(scope, 255) || !text(name.trim(), 255) || /[/\\\0]/.test(name) ||
      !(holder === undefined || text(holder, 128))) {
    throw new Error("Invalid document creation.");
  }
  const own = !!holder && entry.creation?.holder === holder && !entry.creation.receipt;
  if (entry.binding || (entry.creation && !own && !stale(entry.creation, now))) return {entry, creation: null};
  let creation: NativeMnemosCreation = {claim, accountId, scope, name: name.trim(), at: now, ...(holder ? {holder} : {})};
  return {entry: {creation}, creation};
}

/** Снять захват, по которому ничего не отправлено (нет квитанции): создание упало или вкладку закрыли.
 *  Захват с квитанцией остаётся — по нему любая вкладка повторяет ту же заявку без второго документа. */
export function releaseMnemosCreation(entry: MnemosDocumentEntry, claim: string): MnemosDocumentEntry {
  if (entry.binding || !entry.creation || entry.creation.claim !== claim || entry.creation.receipt) return entry;
  return {};
}

export function recordMnemosReceipt(entry: MnemosDocumentEntry, claim: string, receipt: string): MnemosDocumentEntry {
  if (!entry.creation || entry.creation.claim !== claim || entry.binding) throw new Error("Document creation changed.");
  if (!text(receipt, 4096)) throw new Error("Invalid creation receipt.");
  if (entry.creation.receipt && entry.creation.receipt !== receipt) throw new Error("Document creation changed.");
  return {creation: {...entry.creation, receipt}};
}

export function setMnemosBinding(binding: unknown): MnemosDocumentEntry {
  return binding === null ? {} : {binding: validateMnemosBinding(binding)};
}

/** Первый проект беседы — туда документ сохраняется сам. Проекты беседы принадлежат её создателю:
 *  чужому человеку проект не предлагается, его подключения там нет. */
export function mnemosProjectForChat(
    meta: {projectContext?: NonNullable<Parameters<typeof chatProjects>[0]> & {creatorId?: string}} | undefined,
    userId: string): NativeMnemosState["project"] {
  let context = meta?.projectContext;
  if (!context || context.creatorId !== userId) return null;
  let first = chatProjects(context)[0];
  return first ? {accountId: first.accountId, projectId: first.projectId, title: first.title} : null;
}

export function mnemosDocumentState(entry: MnemosDocumentEntry | undefined, project: NativeMnemosState["project"], now: number): NativeMnemosState {
  let creation = entry?.creation && !entry.binding ? entry.creation : null;
  return {
    binding: entry?.binding ?? null,
    // Устаревший захват без квитанции ничего не создал: вкладке его не показываем.
    creation: creation && (creation.receipt || !stale(creation, now)) ? creation : null,
    project: entry?.binding ? null : project,
  };
}
