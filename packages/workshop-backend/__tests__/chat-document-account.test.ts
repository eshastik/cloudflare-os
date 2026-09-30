import { expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { UserDurableObject } from "../src/user.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv { TEST_USER: DurableObjectNamespace<UserDurableObject>; }
}

it("принимает документы беседы только через выбранное действующее подключение Mnemos", async () => {
  await runInDurableObject(env.TEST_USER.getByName("chat-document-account"), async user => {
    const original = user.storage;
    const issue = vi.fn(async () => ({ request: "request", projectId: "personal", uploadId: "upload" }));
    const other = vi.fn(async () => { throw new Error("чужое подключение вызвано"); });
    const records = [
      { id: 1, vendorId: "other", description: { providesUi: true }, account: { beginChatDocument: other } },
      { id: 2, vendorId: "mnemos", description: { providesUi: true }, credentialsExpired: true, account: { beginChatDocument: other } },
      { id: 3, vendorId: "mnemos", description: { providesUi: true }, account: { beginChatDocument: issue } },
    ];
    const file = { name: "файл.txt", contentType: "text/plain", size: 1, sha256: "0".repeat(64) };
    Object.assign(user, { storage: { connectedAccounts: {
      list: () => records, get: (id: number) => records.find(record => record.id === id),
    } } });
    try {
      records.pop();
      expect(await user.hasChatProjectSource()).toBe(false);
      await expect(user.beginChatDocument(null, null, file)).rejects.toThrow("Mnemos не подключён");
      records.push({ id: 3, vendorId: "mnemos", description: { providesUi: true }, account: { beginChatDocument: issue } });
      expect(await user.hasChatProjectSource()).toBe(true);
      await expect(user.beginChatDocument(null, null, file)).resolves.toMatchObject({ accountId: 3, uploadId: "upload" });
      await expect(user.beginChatDocument(1, null, file)).rejects.toThrow("Подключение Mnemos недоступно");
      await expect(user.beginChatDocument(2, null, file)).rejects.toThrow("недоступно");
      await expect(user.beginChatDocument(99, null, file)).rejects.toThrow("недоступно");
      expect(issue).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
    } finally { Object.assign(user, { storage: original }); }
  });
});
