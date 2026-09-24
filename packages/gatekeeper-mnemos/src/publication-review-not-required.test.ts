import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError, REVIEW_NOT_REQUIRED } from "./mnemos-api.ts";

// Дефект 2026-09-24: заявка на согласование в проекте без политики отвечала 403, и «Опубликовать»
// выглядело как отказ в праве. Теперь сервер отвечает 409 с кодом «согласование не требуется»,
// а шлюз отличает его от отказа в праве и от прочих 409 (сдвинутая голова).
test("заявка без политики согласования: код «не требуется» отличим от отказа в праве и от сдвинутой головы", async () => {
  const head = "a".repeat(64);
  const answer = (status: number, code: string) => new MnemosAPI("https://memory.example", async () => "human",
    async () => Response.json({ code, message: "x" }, { status }));
  await assert.rejects(answer(409, REVIEW_NOT_REQUIRED).requestPublicationReview("project", head, head),
    (e: unknown) => e instanceof MnemosAPIError && e.status === 409 && e.code === REVIEW_NOT_REQUIRED);
  await assert.rejects(answer(409, "branch.head_moved").requestPublicationReview("project", head, head),
    (e: unknown) => e instanceof MnemosAPIError && e.status === 409 && e.code === undefined);
  await assert.rejects(answer(403, "authz.access_denied").requestPublicationReview("project", head, head),
    (e: unknown) => e instanceof MnemosAPIError && e.status === 403 && e.code === undefined);
  // Код «не требуется» с чужим статусом не принимается.
  await assert.rejects(answer(403, REVIEW_NOT_REQUIRED).requestPublicationReview("project", head, head),
    (e: unknown) => e instanceof MnemosAPIError && e.code === undefined);
});
