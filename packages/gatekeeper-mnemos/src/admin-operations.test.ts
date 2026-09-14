import {test} from "node:test";
import assert from "node:assert/strict";
import {checkedAdminOperation, type AdminOperationRequest} from "./admin-operations.ts";

test("неверная область не превращается в доступ ко всем материалам", () => {
  for (const domain of [false, 0, null, [], {}, " финансы", "финансы\n"]) {
    assert.throws(() => checkedAdminOperation({kind: "grant_project_access", person: "Иван", project: "Продажи", domain, mode: "read"} as unknown as AdminOperationRequest));
  }
  assert.deepEqual(checkedAdminOperation({kind: "grant_project_access", person: "Иван", project: "Продажи", domain: "", mode: "read"}), {kind: "grant_project_access", person: "Иван", project: "Продажи", mode: "read"});
});

test("административное предложение не допускает широких полномочий и скрытых полей", () => {
  for (const input of [
    {kind: "grant_tenant_capability", capability: "principal.manage"},
    {kind: "grant_project_access", person: "Иван", project: "Продажи", mode: "admin"},
    {kind: "grant_project_access", person: "Иван", project: "Продажи", mode: "read", capability: "principal.manage"},
    {kind: "create_project", name: "Проект", slug: "project", owner_id: "other"},
  ]) assert.throws(() => checkedAdminOperation(input as AdminOperationRequest));
});
