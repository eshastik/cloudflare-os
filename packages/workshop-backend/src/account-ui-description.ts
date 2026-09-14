import type { AccountDescription, GatekeeperUser } from "@gadgets/workshop-shared/gatekeeper";

/** Обновляет только меню существующего UI; сохранённое описание остаётся источником остальных полномочий. */
export async function refreshAccountUiDescription(
  description: AccountDescription,
  account: Pick<GatekeeperUser, "describe">,
): Promise<AccountDescription> {
  if (!description.providesUi) return description;
  try {
    const fresh = await account.describe();
    return { ...description, providesUi: fresh.providesUi };
  } catch {
    // При истёкшей сессии оставляем вход для восстановления, но убираем прежние пункты доступа.
    const { title, icon } = description.providesUi;
    return { ...description, providesUi: { title, icon } };
  }
}
