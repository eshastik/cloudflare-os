// Как проводится вход в оболочку через конкретный гейткипер.
//
// Обычный гейткипер (Google, GitHub) только подтверждает почту: разрешение временное, а решение,
// пускать ли нового человека, принимает оболочка по флагу регистрации.
//
// Mnemos — другое дело. Это рабочее пространство организации, и вход в оболочку через него
// одновременно подключает Mnemos (иначе человеку пришлось бы входить второй раз). И пускать ли
// человека, решает сам Mnemos: его вход проходит только у заведённого человека или у того, кто
// принял приглашение. Поэтому закрытая регистрация оболочки здесь не мешает заведению учётной
// записи оболочки — иначе приглашённый сотрудник упирался бы в «регистрация закрыта».

export const MNEMOS_VENDOR_ID = "mnemos";
const CLOUDFLARE_VENDOR_ID = "cloudflare";

export interface GatekeeperLoginPolicy {
  /** Какой объём доступа просить у гейткипера при входе. */
  scopes: "auth" | "full";
  /** Сохранить ли полученное подключение как подключённую учётную запись пользователя. */
  persistConnection: boolean;
  /** Можно ли завести новую учётную запись оболочки при первом входе. */
  allowCreate: boolean;
}

export function gatekeeperLoginPolicy(vendorId: string, signupsEnabled: boolean): GatekeeperLoginPolicy {
  if (vendorId === MNEMOS_VENDOR_ID) return { scopes: "full", persistConnection: true, allowCreate: true };
  // Cloudflare при входе сразу привязывает оплату AI Gateway, поэтому подключение сохраняется.
  if (vendorId === CLOUDFLARE_VENDOR_ID) return { scopes: "full", persistConnection: true, allowCreate: signupsEnabled };
  return { scopes: "auth", persistConnection: false, allowCreate: signupsEnabled };
}
