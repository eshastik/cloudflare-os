// @vitest-environment jsdom
import * as React from "react";
import {createRoot} from "react-dom/client";
import {createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {afterEach, expect, it, vi} from "vitest";
import {SidebarWorkspacesProvider, useWorkspacesContext} from "./SidebarWorkspaces";
const api = vi.hoisted(() => ({listGadgets: vi.fn(), whoami: vi.fn(async () => null)}));
vi.mock('../../AuthContext', () => ({useAuthenticatedApi: () => ({authenticatedApi: api})}));
vi.mock('@cloudflare/kumo', () => ({useKumoToastManager: () => ({add: vi.fn()})}));
vi.mock('../../ShareModal', () => ({default: () => null}));
vi.mock('../DeleteConfirmationDialog', () => ({default: () => null}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {vi.useRealTimers(); vi.clearAllMocks()});
it('новая беседа и новое название появляются без перезагрузки; скрытая вкладка не опрашивается', async () => {
  vi.useFakeTimers();
  let list = [{id: 'one', title: 'Первая', created: new Date(0), lastActive: new Date(0)}];
  api.listGadgets.mockImplementation(async () => list);
  const View = () => <div>{useWorkspacesContext().gadgets.map(g => g.title).join(',')}</div>;
  const route = createRootRoute({component: () => <SidebarWorkspacesProvider><View/></SidebarWorkspacesProvider>});
  const router = createRouter({history: createMemoryHistory({initialEntries: ['/']}), routeTree: route.addChildren([createRoute({getParentRoute: () => route, path: '/workspace/$id'})])});
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
  try {
    await React.act(async () => {root.render(<RouterProvider router={router}/>); await vi.advanceTimersByTimeAsync(0)});
    expect(el.textContent).toContain('Первая');
    list = [...list, {...list[0], id: 'two', title: 'Новая'}];
    await React.act(async () => {await router.navigate({to: '/workspace/$id', params: {id: 'two'}})});
    expect(el.textContent).toContain('Новая');
    list = [{...list[0], title: 'Переименована'}];
    await React.act(async () => {await vi.advanceTimersByTimeAsync(5000)});
    expect(el.textContent).toContain('Переименована');
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
    const calls = api.listGadgets.mock.calls.length;
    await React.act(async () => {await vi.advanceTimersByTimeAsync(15000)});
    expect(api.listGadgets.mock.calls.length).toBe(calls);
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
    list = [{...list[0], title: 'Из Telegram'}];
    await React.act(async () => {document.dispatchEvent(new Event('visibilitychange'))});
    expect(el.textContent).toContain('Из Telegram');
  } finally {await React.act(async () => root.unmount()); el.remove()}
});
