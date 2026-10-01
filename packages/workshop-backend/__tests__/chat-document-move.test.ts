import { expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { OverseerDurableObject, ActionRecord } from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
}

function moveActionRecord(): ActionRecord & {type: "action"} {
  return {id: 1, gatekeeperId: 7, type: "action", action: 2,
      state: "pending", createdAt: new Date(), caller: {from: "agent", chatId: 1},
      description: {ownerApprovalRequired: true, actionKind: {tag: "mnemos.move_file", label: "Перенести"}},
  } as ActionRecord & {type: "action"};
}


it("после подтверждённого переноса обновляет только вложения этого подключения и их прежние права", async () => {
  await runInDurableObject(env.TEST_OVERSEER.getByName("chat-document-move"), async instance => {
    const impl = instance["impl"];
    const document = { accountId: 3, projectId: "personal", projectTitle: "Личное", personal: true,
      resource: "old-node", name: "файл.txt", contentType: "text/plain", size: 10 };
    const first = "10000000-0000-4000-8000-000000000001";
    const other = "10000000-0000-4000-8000-000000000002";
    const staged = "10000000-0000-4000-8000-000000000003";
    const put = (id: string, accountId: number) => impl.storage.chatAttachmentContent.put({
      fileId: id, data: new Uint8Array(0), state: {type: "committed", chatId: 1, document: {...document, accountId}},
    });
    put(first, 3); put(other, 4);
    impl.storage.chats.put({chatId: 1, sequence: 0, timestamp: new Date(),
      type: "message", author: {type: "user", id: "owner", name: "Владелец"}, message: "Учебные вложения",
      attachments: [
        {id: first, mimeType: "text/plain", document},
        {id: other, mimeType: "text/plain", document: {...document, accountId: 4}},
      ]});
    const updated = vi.fn();
    impl.storage.chats.subscribe({add() {}, remove() {}, update: updated});
    impl.storage.chatAttachmentContent.put({fileId: staged, data: new Uint8Array(0),
      state: {type: "staged", uploadedAt: Date.now(), mimeType: "text/plain", document}});
    impl.grantChatDocument(1, document);
    impl.storage.gatekeepers.put({id: 7, class: {} as never,
      creationSpec: {type: "ambient", vendorId: "mnemos", accountId: 3}});
    let outcome: unknown = {summary: "Файл перенесён", chatDocumentMove: {
      from: {projectId: "personal", resource: "old-node"},
      to: {projectId: "team", projectTitle: "Проект", resource: "new-node", name: "файл 2.txt"},
    }};
    const facet = vi.spyOn(impl, "getGatekeeperFacet").mockReturnValue({applyAction: async () => outcome} as never);
    try {
      await impl.applyPendingAction(moveActionRecord(), {type: "user", id: "owner", name: "Владелец"}, false, true);
      expect(impl.getChatAttachmentDocument(first)).toMatchObject({accountId: 3, projectId: "team",
        resource: "new-node", projectTitle: "Проект", name: "файл 2.txt", personal: false, size: 10});
      expect(impl.getChatAttachmentDocument(other)).toMatchObject({accountId: 4, projectId: "personal", resource: "old-node"});
      expect(impl.getChatAttachmentDocument(staged)).toMatchObject({projectId: "personal", resource: "old-node"});
      expect(updated).toHaveBeenCalledTimes(1);
      const delivered = impl.hydrateChatMessageForClient(updated.mock.calls[0][1]);
      expect(delivered.type === "message" && delivered.attachments?.[0].document).toMatchObject({projectId: "team", resource: "new-node"});
      expect(delivered.type === "message" && delivered.attachments?.[1].document).toMatchObject({accountId: 4, projectId: "personal", resource: "old-node"});
      expect(() => impl.authorizeChatDocument({from: "agent", chatId: 1}, "personal", "old-node", 3)).toThrow();
      expect(() => impl.authorizeChatDocument({from: "agent", chatId: 1}, "team", "new-node", 3)).not.toThrow();
      expect(() => impl.authorizeChatDocument({from: "agent", chatId: 1}, "personal", "old-node", 4)).not.toThrow();
      expect(() => impl.authorizeChatDocument({from: "agent", chatId: 1}, "team", "new-node", 4)).toThrow();

      put(first, 3);
      impl.storage.gatekeepers.put({id: 7, class: {} as never,
        creationSpec: {type: "ambient", vendorId: "other", accountId: 3}});
      await impl.applyPendingAction({...moveActionRecord(), description: {actionKind: {tag: "mnemos.move_file", label: "Перенести"}}},
        {type: "user", id: "owner", name: "Владелец"}, false, true);
      expect(impl.getChatAttachmentDocument(first)?.resource).toBe("old-node");

      impl.storage.gatekeepers.put({id: 7, class: {} as never,
        creationSpec: {type: "ambient", vendorId: "mnemos", accountId: 3}});
      outcome = {summary: "Файл перенесён", chatDocumentMove: {from: {projectId: "personal", resource: "old-node"},
        to: {projectId: "team", resource: "", name: "файл", projectTitle: "Проект"}}};
      await impl.applyPendingAction(moveActionRecord(), {type: "user", id: "owner", name: "Владелец"}, false, true);
      expect(impl.getChatAttachmentDocument(first)?.resource).toBe("old-node");
    } finally { facet.mockRestore(); }
  });
});
