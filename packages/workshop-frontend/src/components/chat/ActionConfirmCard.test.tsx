// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionConfirmCard, type ActionConfirmState } from "./ActionConfirmCard";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

function render(state: ActionConfirmState, extra: Partial<Parameters<typeof ActionConfirmCard>[0]> = {}) {
  const handlers = { onApprove: vi.fn(), onReject: vi.fn() };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(
    <ActionConfirmCard icon="share" title="Поделиться документом «План продаж»: Николай Деревцов — может править"
      details={["Проект «Продажи»", "Сейчас доступа к документу нет"]} state={state} busy={false} {...handlers} {...extra} />,
  ));
  const buttons = () => [...host!.querySelectorAll("button")].map(b => b.textContent?.trim());
  return { host, handlers, buttons };
}

describe("карточка подтверждения действия агента", () => {
  it("до решения: заголовок, подробности словами и две кнопки; «Разрешать всегда» только для разрешаемых видов", () => {
    const { host, handlers, buttons } = render("pending");
    expect(host.textContent).toContain("Поделиться документом «План продаж»: Николай Деревцов — может править");
    expect(host.textContent).toContain("Сейчас доступа к документу нет");
    expect(buttons()).toEqual(["Подтвердить", "Отклонить"]);
    act(() => (host.querySelectorAll("button")[0] as HTMLButtonElement).click());
    act(() => (host.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(handlers.onApprove).toHaveBeenCalledOnce();
    expect(handlers.onReject).toHaveBeenCalledOnce();
    expect(host.querySelector("[role=group]")?.getAttribute("aria-label")).toBe("Нужно ваше подтверждение");
  });

  it("разрешаемый насовсем вид показывает третью кнопку", () => {
    const always = vi.fn();
    const { host, buttons } = render("pending", { onAlwaysApprove: always });
    expect(buttons()).toEqual(["Подтвердить", "Разрешать всегда", "Отклонить"]);
    act(() => (host.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(always).toHaveBeenCalledOnce();
  });

  it("после подтверждения: «Сделано», итог и безопасная ссылка на результат, кнопок нет", () => {
    const { host, buttons } = render("approved", { outcome: { summary: "Николай Деревцов может править «План продаж»", url: "https://mnemos.example/doc" } });
    expect(buttons()).toEqual([]);
    expect(host.textContent).toContain("Сделано");
    expect(host.textContent).toContain("Николай Деревцов может править «План продаж»");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://mnemos.example/doc");
  });

  it("после отказа: «Вы отклонили», без итога и ссылки", () => {
    const { host, buttons } = render("rejected", { outcome: { summary: "не должно показываться", url: "https://x.example" } });
    expect(buttons()).toEqual([]);
    expect(host.textContent).toContain("Вы отклонили");
    expect(host.textContent).not.toContain("не должно показываться");
    expect(host.querySelector("a")).toBeNull();
  });

  it("ссылка не на http(s) не показывается", () => {
    const { host } = render("approved", { outcome: { summary: "Готово", url: "javascript:alert(1)" } });
    expect(host.querySelector("a")).toBeNull();
  });

  it("карточка-переход: главная кнопка открывает экран и отмечает действие, после — «открыть снова»", () => {
    const onOpen = vi.fn();
    const { host, handlers, buttons } = render("pending", { open: { label: "Открыть «Подключения»", onOpen } });
    expect(buttons()).toEqual(["Открыть «Подключения»", "Отклонить"]);
    act(() => (host.querySelectorAll("button")[0] as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(handlers.onApprove).toHaveBeenCalledOnce();
    act(() => root?.unmount()); host.remove();
    const done = render("approved", { outcome: { summary: "Экран открыт" }, open: { label: "Открыть «Подключения»", onOpen } });
    expect(done.buttons()).toEqual(["Открыть «Подключения»"]);
  });

  it("экран недоступен (нет приложения) — кнопка перехода неактивна", () => {
    const { host } = render("pending", { open: { label: "Открыть «Подключения»" } });
    expect((host.querySelectorAll("button")[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
