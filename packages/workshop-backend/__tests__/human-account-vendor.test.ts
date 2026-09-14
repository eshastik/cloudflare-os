import { expect, it } from "vitest";
import { UserDurableObject } from "../src/user.js";

it("discovers an explicit human UI without agent resources and respects the vendor disable switch", async () => {
  let disabled: string[] = [];
  let provisions = 0;
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  const vendor = (humanUi: boolean) => ({
    async describe() { return { displayName: "Memory", url: "https://memory.example", providesAccountUi: humanUi }; },
    async getSupportedResources() { return []; },
    async createAccount() { provisions++; throw new Error("Discovery must not provision"); },
  });
  Object.assign(user, {
    env: { BLUEPRINTS: { get: async () => JSON.stringify({ disabledGatekeepers: disabled }) } },
    storage: { profile: { get: () => ({ id: "human" }) } },
    vendors: new Map([["mnemos", vendor(true)], ["empty", vendor(false)]]),
  });
  const listed = await user.listGatekeeperVendors();
  expect(listed.map(v => v.id)).toEqual(["mnemos"]);
  expect(listed[0].supportedResources).toEqual([]);
  expect(provisions).toBe(0);
  disabled = ["mnemos"];
  expect(await user.listGatekeeperVendors()).toEqual([]);
});

const resource = (receives?: "mail" | "calendar") => ({ urlPattern: `memory://${receives ?? "notes"}/*`, title: "Memory", description: "", ...(receives ? { receives } : {}) });
const account = (resources: ReturnType<typeof resource>[]) => ({
  async getSupportedResources() { return resources; },
  // A gatekeeper cannot issue host capabilities itself: whatever it puts in the frame is dropped.
  async startAppUi() { return { iframeHtml: "<p>app</p>", ui: {}, mailDraftSender: "spoofed", calendarDraftCreator: "spoofed" }; },
});
it("issues the draft sender and creator only to the app of an account whose resources receive mail or calendar sources", async () => {
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  const records = new Map([
    [1, { id: 1, vendorId: "memory", account: account([resource("mail"), resource("calendar")]), description: { providesUi: { title: "Memory" } } }],
    [2, { id: 2, vendorId: "memory", account: account([resource("mail")]), description: { providesUi: { title: "Memory" } } }],
    [3, { id: 3, vendorId: "other", account: account([resource()]), description: { providesUi: { title: "Other" } } }],
  ]);
  Object.assign(user, {
    storage: { connectedAccounts: { get: (id: number) => records.get(id) } },
    ctx: { id: { toString: () => "human" }, exports: { MailDraftSendUI: ({ props }: any) => `sender:${props.accountId}`, CalendarDraftCreateUI: ({ props }: any) => `creator:${props.accountId}` } },
  });
  const context = { isAdmin: false };
  expect(await user.startAccountAppUi(1, context)).toMatchObject({ mailDraftSender: "sender:1", calendarDraftCreator: "creator:1" });
  const mailOnly = await user.startAccountAppUi(2, context);
  expect(mailOnly.mailDraftSender).toBe("sender:2");
  expect("calendarDraftCreator" in mailOnly).toBe(false);
  const undeclared = await user.startAccountAppUi(3, context);
  expect("mailDraftSender" in undeclared).toBe(false);
  expect("calendarDraftCreator" in undeclared).toBe(false);
});
