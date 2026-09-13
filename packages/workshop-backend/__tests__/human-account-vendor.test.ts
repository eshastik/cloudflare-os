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
