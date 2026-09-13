import { describe, it, expect } from "vitest";
import { emptyWorkspaceActivity, recordWorkspaceActivity } from "../src/workspace-activity";

const one = "a".repeat(32), two = "b".repeat(32);
describe("workspace activity accounting", () => {
  it("does not count an open idle tab as a work session", () => {
    const state = recordWorkspaceActivity(emptyWorkspaceActivity(), one, 1, false, 1000);
    expect(state.sessions).toBe(0); expect(state.activeMs).toBe(0);
  });
  it("deduplicates repeats, out-of-order messages and overlapping tabs", () => {
    let s = recordWorkspaceActivity(emptyWorkspaceActivity(), one, 1, true, 1000);
    s = recordWorkspaceActivity(s, two, 1, true, 1000);
    s = recordWorkspaceActivity(s, one, 2, true, 16000);
    s = recordWorkspaceActivity(s, two, 2, true, 16000);
    const replay = recordWorkspaceActivity(s, one, 2, true, 20000);
    expect(replay).toBe(s);
    expect(recordWorkspaceActivity(s, one, 1, true, 21000)).toBe(s);
    expect(s.activeMs).toBe(15000); expect(s.sessions).toBe(1);
    expect(s.sessionElapsedMs).toBe(15000);
  });
  it("does not charge hidden intervals, reconnect gaps or missing observations", () => {
    let s = recordWorkspaceActivity(emptyWorkspaceActivity(), one, 1, true, 1000);
    s = recordWorkspaceActivity(s, one, 2, false, 16000);
    s = recordWorkspaceActivity(s, one, 3, true, 31000);
    expect(s.activeMs).toBe(0);
    s = recordWorkspaceActivity(s, one, 4, true, 100000);
    expect(s.activeMs).toBe(0);
    s = recordWorkspaceActivity(s, one, 5, true, 115000);
    expect(s.activeMs).toBe(15000);
  });
  it("starts a new work session after 30 minutes of inactivity without charging the gap", () => {
    let s = recordWorkspaceActivity(emptyWorkspaceActivity(), one, 1, true, 1000);
    s = recordWorkspaceActivity(s, one, 2, true, 16000);
    s = recordWorkspaceActivity(s, one, 3, true, 2_000_000);
    expect(s.sessions).toBe(2); expect(s.activeMs).toBe(15000);
    expect(s.sessionElapsedMs).toBe(15000);
  });
  it("bounds stream storage and refuses malformed samples", () => {
    let s = emptyWorkspaceActivity();
    for (let i=0;i<40;i++) s=recordWorkspaceActivity(s,i.toString(16).padStart(32,"0"),1,false,1000);
    expect(Object.keys(s.streams)).toHaveLength(32);
    expect(() => recordWorkspaceActivity(s,"bad",1,true,1000)).toThrow();
    expect(() => recordWorkspaceActivity(s,one,0,true,1000)).toThrow();
    s=recordWorkspaceActivity(s,one,1,true,2_000_000);
    expect(Object.keys(s.streams)).toHaveLength(1);
  });
  it("retains deduplication state across serialization and ignores backwards clocks", () => {
    let s=recordWorkspaceActivity(emptyWorkspaceActivity(),one,1,true,1000);
    s=recordWorkspaceActivity(s,one,2,true,16000);
    s=JSON.parse(JSON.stringify(s));
    expect(recordWorkspaceActivity(s,one,2,true,20000)).toBe(s);
    expect(recordWorkspaceActivity(s,one,3,true,15000)).toBe(s);
  });
});
