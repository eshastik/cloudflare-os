// Выбор подключения для страницы приложения шлюза (/gatekeepers/<vendor>).
//
// Прежде каждое открытие страницы сначала заводило недостающие автоматические подключения, а для этого
// опрашивало describe() у всех шлюзов установки (их 19, на проде это секунды). Опрос нужен, только когда
// подходящего подключения ещё нет. Если оно есть, выбор тот же, что и после опроса: берётся первое
// подходящее по номеру, а опрос может лишь добавить новое подключение с большим номером.

export type UiAccountRecord = {
  id: number;
  vendorId: string;
  autoProvisioned?: boolean;
  description: { providesUi?: unknown };
};

export async function findUiAccount(options: {
  records: () => Iterable<UiAccountRecord>;
  /** Автоматическое подключение выключенного администратором шлюза: интерфейс не показывается. */
  dormant: (record: UiAccountRecord) => boolean;
  /** Заводит недостающие автоматические подключения (опрос describe() всех шлюзов). */
  ensure: () => Promise<void>;
  vendorId: string;
  accountId?: number;
}): Promise<number | null> {
  const pick = () => {
    for (const record of options.records()) {
      if (record.vendorId !== options.vendorId || !record.description.providesUi) continue;
      if (record.autoProvisioned && options.dormant(record)) continue;
      if (options.accountId !== undefined && record.id !== options.accountId) continue;
      return record.id;
    }
    return null;
  };
  const known = pick();
  if (known !== null) return known;
  await options.ensure();
  return pick();
}
