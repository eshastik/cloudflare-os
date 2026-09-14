import { createContext, useContext } from "react";
import type { RpcStub } from "capnweb";
import type { Host, Management } from "../app/main.ts";

export type HostStub = RpcStub<Host>;
/** Свойство стаба, а не RpcStub<Management>: capnweb отдаёт вложенный объект как конвейерный стаб. */
export type Ui = HostStub["ui"];
export type { Management };

export interface HostContextValue {
  host: HostStub;
  /** Взят у стаба один раз: каждое обращение к host.ui даёт новый объект, а хуки React сравнивают зависимости по ссылке. */
  ui: Ui;
  /** Контейнер прежних разделов: вкладки переносят его внутрь себя, когда открывают перенесённый раздел. */
  legacy: HTMLElement;
}

const HostContext = createContext<HostContextValue | null>(null);

export const HostProvider = HostContext.Provider;

export function makeHostContext(host: HostStub, legacy: HTMLElement): HostContextValue {
  return { host, ui: host.ui, legacy };
}

function useHostContext(): HostContextValue {
  const value = useContext(HostContext);
  if (!value) throw new Error("Хост фрейма не передан в дерево React");
  return value;
}

export function useHost(): HostStub {
  return useHostContext().host;
}

export function useUi(): Ui {
  return useHostContext().ui;
}

export function useLegacyContainer(): HTMLElement {
  return useHostContext().legacy;
}
