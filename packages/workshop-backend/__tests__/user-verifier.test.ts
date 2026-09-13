import { describe, expect, it } from "vitest";
import type { GatekeeperUser, GatekeeperUserVerifier } from "@gadgets/workshop-shared/gatekeeper";
import { UserDurableObject } from "../src/user.js";
import { DEFAULT_ADMIN_CONFIG, serializeAdminConfig } from "../src/admin-config.js";

function makeUserWithAccount(vendorId: string) {
  const verifier = {} as Fetcher<GatekeeperUserVerifier>;
  let verifierRequests = 0;
  let config = DEFAULT_ADMIN_CONFIG;
  let live = true, expired = false;
  let duringCall = () => {};
  const account = {
    async getVerifier() {
      verifierRequests++;
      duringCall();
      return verifier;
    },
  } as Fetcher<GatekeeperUser>;
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  Object.assign(user, {
    env: { BLUEPRINTS: { get: async () => serializeAdminConfig(config) } },
    storage: {
      connectedAccounts: {
        get: (accountId: number) => accountId === 7 && live
          ? { id: accountId, account, vendorId, credentialsExpired: expired }
          : undefined,
      },
    },
  });
  return { user, verifier, verifierRequests: () => verifierRequests,
    setConfig: (value: typeof config) => { config = value; },
    expire: () => { expired = true; }, disconnect: () => { live = false; },
    duringCall: (callback: () => void) => { duringCall = callback; },
  };
}

describe("UserDurableObject.getVerifier", () => {
  it("refuses disabled vendors and resource types before minting a verifier", async () => {
    const h = makeUserWithAccount("mnemos");
    h.setConfig({ ...DEFAULT_ADMIN_CONFIG, disabledGatekeepers: ["mnemos"] });
    await expect(h.user.getVerifier(7, "mnemos", "document")).rejects.toThrow("disabled");
    h.setConfig({ ...DEFAULT_ADMIN_CONFIG, disabledResources: { mnemos: ["document"] } });
    await expect(h.user.getVerifier(7, "mnemos", "document")).rejects.toThrow("disabled");
    expect(h.verifierRequests()).toBe(0);
    await expect(h.user.getVerifier(7, "mnemos", "other")).resolves.toBe(h.verifier);
  });

  it.each(["resource", "vendor", "expired", "disconnected"])(
      "rejects %s revocation while the verifier request is pending", async reason => {
    const h = makeUserWithAccount("mnemos");
    h.duringCall(() => {
      if (reason === "resource") h.setConfig({ ...DEFAULT_ADMIN_CONFIG, disabledResources: { mnemos: ["document"] } });
      if (reason === "vendor") h.setConfig({ ...DEFAULT_ADMIN_CONFIG, disabledGatekeepers: ["mnemos"] });
      if (reason === "expired") h.expire();
      if (reason === "disconnected") h.disconnect();
    });
    await expect(h.user.getVerifier(7, "mnemos", "document")).rejects.toThrow(
        reason === "resource" || reason === "vendor" ? "disabled" : "unavailable");
    expect(h.verifierRequests()).toBe(1);
  });

  it("returns a verifier when the connected account belongs to the expected vendor", async () => {
    const { user, verifier, verifierRequests } = makeUserWithAccount("notion");

    await expect(user.getVerifier(7, "notion")).resolves.toBe(verifier);
    expect(verifierRequests()).toBe(1);
  });

  it("returns null when the account is missing", async () => {
    const { user, verifierRequests } = makeUserWithAccount("notion");

    await expect(user.getVerifier(999, "notion")).resolves.toBeNull();
    expect(verifierRequests()).toBe(0);
  });

  it("throws when the connected account belongs to another vendor", async () => {
    const { user, verifierRequests } = makeUserWithAccount("linear");

    await expect(user.getVerifier(7, "notion")).rejects.toThrow(
        "Invalid account selection for this service.");
    expect(verifierRequests()).toBe(0);
  });
});
