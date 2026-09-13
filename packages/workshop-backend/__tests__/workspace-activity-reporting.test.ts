import { describe, expect, it } from "vitest";
import { UserDurableObject } from "../src/user.js";
import { DEFAULT_ADMIN_CONFIG, serializeAdminConfig } from "../src/admin-config.js";

function fixture() {
  const slot = <T>(value: T) => ({ get: () => value, put: (next: T) => { value = next; } });
  const selected = slot<number | null>(null), delivery = slot("disabled"), activity = slot<unknown>(null);
  let config = DEFAULT_ADMIN_CONFIG, live = true, expired = false, fail = false;
  const samples: unknown[][] = [];
  const readiness: unknown[] = [];
  const account = { async recordUIReadiness(sample: unknown) { readiness.push(sample); if (fail) throw new Error("unavailable"); }, async recordWorkspaceActivity(...sample: unknown[]) { samples.push(sample); if (fail) throw new Error("unavailable"); } };
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  Object.assign(user, {
    env: { BLUEPRINTS: { get: async () => serializeAdminConfig(config) } },
    storage: { workspaceActivity: activity, workspaceActivityAccount: selected, workspaceActivityDelivery: delivery,
      nextAccountId: slot(8), connectedAccounts: { get: (id: number) => id === 7 && live ? { id, account, vendorId: "mnemos", description: { receivesWorkspaceActivity: true, displayName: "Team" }, credentialsExpired: expired } : undefined } },
  });
  return { user, samples, readiness, selected, delivery, disable: () => { config = { ...DEFAULT_ADMIN_CONFIG, disabledGatekeepers: ["mnemos"] }; }, expire: () => { expired = true; }, disconnect: () => { live = false; }, fail: () => { fail = true; } };
}
const stream = "a".repeat(32);
describe("explicit workspace activity delivery", () => {
  it("is off by default and sends only to the user's chosen connected account", async () => {
    const f = fixture();
    await f.user.recordOwnWorkspaceActivity(stream, 1, true);
    expect(f.samples).toHaveLength(0);
    await expect(f.user.setWorkspaceActivityReporting(8)).rejects.toThrow();
    await f.user.setWorkspaceActivityReporting(7);
    await f.user.recordOwnWorkspaceActivity(stream, 2, true);
    expect(f.samples).toEqual([[stream, 2, true]]);
    expect((await f.user.getWorkspaceActivityReporting()).delivery).toBe("sent");
    await f.user.setWorkspaceActivityReporting(null);
    await f.user.recordOwnWorkspaceActivity(stream, 3, true);
    expect(f.samples).toHaveLength(1);
  });
  it.each(["disable", "expire", "disconnect"] as const)("stops after %s and retains local accounting", async reason => {
    const f = fixture(); await f.user.setWorkspaceActivityReporting(7); f[reason]();
    await f.user.recordOwnWorkspaceActivity(stream, 1, true);
    expect(f.samples).toHaveLength(0); expect(f.delivery.get()).toBe("unavailable");
    expect(f.user.readOwnWorkspaceActivity().sessions).toBe(1);
    await expect(f.user.setWorkspaceActivityReporting(7)).rejects.toThrow();
  });
  it("does not retry failed delivery or stop the local activity collector", async () => {
    const f = fixture(); await f.user.setWorkspaceActivityReporting(7); f.fail();
    await f.user.recordOwnWorkspaceActivity(stream, 1, true);
    expect(f.samples).toHaveLength(1); expect(f.delivery.get()).toBe("unavailable");
    expect(f.user.readOwnWorkspaceActivity().sessions).toBe(1);
  });
});


describe("UI readiness recipient binding", () => {
  const sample = {observation_id:"b".repeat(32),surface:"cloudflareos.document" as const,outcome:"pending" as const,duration_ms:null};
  it("is off by default, pins the chosen account and does not move a completion", async () => {
    const f=fixture();
    await f.user.recordOwnUIReadiness(sample,7); expect(f.readiness).toHaveLength(0);
    await f.user.setWorkspaceActivityReporting(7);
    await f.user.recordOwnUIReadiness(sample,8); expect(f.readiness).toHaveLength(0);
    await f.user.recordOwnUIReadiness(sample,7); expect(f.readiness).toEqual([sample]);
    f.selected.put(8);
    await f.user.recordOwnUIReadiness({...sample,outcome:"ready",duration_ms:10},7);
    expect(f.readiness).toHaveLength(1);
  });
  it.each(["disable","expire","disconnect"] as const)("stops UI timing after %s", async reason => {
    const f=fixture(); await f.user.setWorkspaceActivityReporting(7); f[reason]();
    await f.user.recordOwnUIReadiness(sample,7); expect(f.readiness).toHaveLength(0);
  });
  it("rechecks selection after awaiting deployment policy", async () => {
    const f=fixture(); await f.user.setWorkspaceActivityReporting(7);
    let release!: (value:string)=>void;
    const delayed=new Promise<string>(resolve=>{release=resolve});
    Object.assign(f.user, {env:{BLUEPRINTS:{get:()=>delayed}}});
    const pending=f.user.recordOwnUIReadiness(sample,7);
    f.selected.put(null);
    release(serializeAdminConfig(DEFAULT_ADMIN_CONFIG));
    await pending; expect(f.readiness).toHaveLength(0);
  });
  it("rejects extra fields before invoking a connector", async () => {
    const f=fixture(); await f.user.setWorkspaceActivityReporting(7);
    await expect(f.user.recordOwnUIReadiness({...sample,user_id:"another"} as typeof sample,7)).rejects.toThrow();
    expect(f.readiness).toHaveLength(0);
  });
});
