import { test } from "node:test";
import assert from "node:assert/strict";
import { documentResourceUrl, parseDocumentResource } from "./document-resource.ts";
import { MnemosAccount, type AccountStorage } from "./account-session.ts";

test("document resource identity cannot switch installation or smuggle path components", () => {
  const origin = "https://memory.example";
  const url = documentResourceUrl(origin, { projectId: "project", nodeId: "document" });
  assert.deepEqual(parseDocumentResource(origin, url), { projectId: "project", nodeId: "document" });
  for (const raw of [url.replace("memory.example", "other.example"), url + "?node=other", url + "#other",
    url.replace("document", "%2Fother"), url.replace("document", "%2e%2e"), url.replace("document", "%64ocument"),
    url.replace("https://", "https://user@"), url + "/", url.replace("https:", "http:")]) {
    assert.throws(() => parseDocumentResource(origin, raw));
  }
});

test("selected reader is fixed to one document and suppresses content after access withdrawal", async () => {
  const map = new Map<string, unknown>();
  const storage: AccountStorage = { get: <T>(k: string) => map.get(k) as T | undefined,
    put: (k, v) => { map.set(k, v); }, delete: k => { map.delete(k); } };
  const paths: string[] = [];
  let denied = false, revokeAfterRead = false, mismatched = false;
  const account = new MnemosAccount(storage, "https://memory.example", async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path === "/v1/whoami") return Response.json({ subject: { tenant_id: "org", user_id: "alice" } });
    if (path === "/v1/projects/project/nodes/document/history") return Response.json({ events: [] }, { status: denied ? 403 : 200 });
    if (path === "/v1/projects/project/nodes/document/history/event/download") {
      return Response.json({ node_id: "document", event_id: "event", content_type: "application/json", url: "https://objects.example/native" });
    }
    if (path === "/v1/nodes/document/content") {
      if (revokeAfterRead) denied = true;
      return Response.json({ node_id: mismatched ? "other" : "document", text: "Published content" });
    }
    assert.fail("Reader widened resource scope");
  });
  await account.connect("fixture-token");
  const session = account.session();
  const resource = { projectId: "project", nodeId: "document" };
  const reader = await session.selectedDocument(resource);
  resource.projectId = "other"; resource.nodeId = "other";
  assert.equal((await reader.readPublished()).text, "Published content");
  assert.equal((await reader.publicationTicket("event")).node_id, "document");
  const beforeInvalidEvent = paths.length;
  await assert.rejects(reader.publicationTicket("../other"));
  assert.equal(paths.length, beforeInvalidEvent);
  await reader.validateRead();
  mismatched = true;
  await assert.rejects(reader.readPublished(), { status: 502 });
  mismatched = false; revokeAfterRead = true;
  await assert.rejects(reader.readPublished());
  const calls = paths.length;
  account.disconnect();
  await assert.rejects(reader.history());
  assert.equal(paths.length, calls);
  assert.equal("publish" in reader, false);
  assert.equal("saveDraftDocument" in reader, false);
  assert.equal("selectedDocument" in reader, false);
});
