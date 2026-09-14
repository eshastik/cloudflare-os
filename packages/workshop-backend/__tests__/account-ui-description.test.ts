import { expect, it, vi } from "vitest";
import type { AccountDescription } from "@gadgets/workshop-shared/gatekeeper";
import { refreshAccountUiDescription } from "../src/account-ui-description";

it("обновляет меню после deploy и не записывает описание аккаунта", async () => {
  const stored: AccountDescription = { providesUi: { title: "Память" } };
  const menu = { title: "Mnemos", sections: [{ id: "documents", title: "Материалы" }] };
  const result = await refreshAccountUiDescription(stored, { describe: async () => ({ providesUi: menu }) });
  expect(result.providesUi).toEqual(menu);
  expect(stored).toEqual({ providesUi: { title: "Память" } });
});

it("свежее описание не добавляет singleton и не превращает обычный аккаунт в UI", async () => {
  const describe = vi.fn(async () => ({ providesUi: { title: "Новый UI" }, singleton: { tsType: "NewAuthority" } }));
  const stored: AccountDescription = { displayName: "Сохранённый аккаунт", providesUi: { title: "UI" } };
  expect(await refreshAccountUiDescription(stored, { describe })).toEqual({ ...stored, providesUi: { title: "Новый UI" } });
  describe.mockClear();
  const ordinary: AccountDescription = { displayName: "Без UI" };
  expect(await refreshAccountUiDescription(ordinary, { describe })).toBe(ordinary);
  expect(describe).not.toHaveBeenCalled();
});

it("ошибка одного аккаунта оставляет recovery без старых admin sections и не мешает другим", async () => {
  const stored: AccountDescription = { providesUi: { title: "Mnemos", sections: [{ id: "people", title: "Люди", group: "manage" }] } };
  const [failed, healthy] = await Promise.all([
    refreshAccountUiDescription(stored, { describe: async () => { throw Error("expired"); } }),
    refreshAccountUiDescription(stored, { describe: async () => ({ providesUi: { title: "Другая организация", sections: [{ id: "documents", title: "Материалы" }] } }) }),
  ]);
  expect(failed.providesUi).toEqual({ title: "Mnemos" });
  expect(healthy.providesUi?.sections?.map(section => section.id)).toEqual(["documents"]);
  expect(stored.providesUi?.sections?.[0].id).toBe("people");
});
