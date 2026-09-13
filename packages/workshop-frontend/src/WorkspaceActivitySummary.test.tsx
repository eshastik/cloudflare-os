// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: { readOwnWorkspaceActivity: vi.fn(), getWorkspaceActivityReporting: vi.fn(), setWorkspaceActivityReporting: vi.fn() } }));
vi.mock("./AuthContext", () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }));
import WorkspaceActivitySummary from "./WorkspaceActivitySummary";

it("selects only an offered recipient and clears stale state when refresh fails", async () => {
  const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = g.IS_REACT_ACT_ENVIRONMENT; g.IS_REACT_ACT_ENVIRONMENT = true;
  let selected: number | null = null;
  api.readOwnWorkspaceActivity.mockResolvedValue({ sessions: 2, activeMs: 60000, sessionElapsedMs: 120000 });
  api.getWorkspaceActivityReporting.mockImplementation(async () => ({ selectedAccountId: selected, accounts: [{ id: 7, label: "Team" }], delivery: selected === null ? "disabled" : "pending" }));
  api.setWorkspaceActivityReporting.mockImplementation(async id => { selected = id; });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const refresh = () => container.querySelector("button")!.click();
  try {
    await act(async () => { root.render(createElement(WorkspaceActivitySummary)); });
    await act(async () => { refresh(); });
    expect(container.textContent).toContain("Рабочие сессии: 2");
    await act(async () => { const select = container.querySelector("select")!; select.value = "7"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(api.setWorkspaceActivityReporting).toHaveBeenLastCalledWith(7);
    expect(container.textContent).toContain("Ожидается первое событие");
    await act(async () => { const select = container.querySelector("select")!; select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(api.setWorkspaceActivityReporting).toHaveBeenLastCalledWith(null);
    api.getWorkspaceActivityReporting.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => { refresh(); });
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("Рабочие сессии: 2");
    expect(container.textContent).toContain("Данные активности недоступны");
  } finally { await act(async () => root.unmount()); container.remove(); g.IS_REACT_ACT_ENVIRONMENT = previous; }
});
