// Разбивка «Всех бесед» и «Результатов» по датам.
import { expect, it } from "vitest";
import { groupByDate } from "./dateGroups";

it("сегодня, вчера, на этой неделе, раньше — пустые группы не показываются, порядок внутри сохраняется", () => {
  const now = new Date(2026, 8, 24, 10, 0);
  const at = (day: number, hour = 9) => new Date(2026, 8, day, hour, 0);
  const items = [
    { id: "a", at: at(24, 8) }, { id: "b", at: at(23, 23) }, { id: "c", at: at(24, 1) },
    { id: "d", at: at(19) }, { id: "e", at: at(17) }, { id: "f", at: at(1) },
  ];
  const groups = groupByDate(items, i => i.at, now);
  expect(groups.map(g => [g.label, g.items.map(i => i.id)])).toEqual([
    ["Сегодня", ["a", "c"]], ["Вчера", ["b"]], ["На этой неделе", ["d"]], ["Раньше", ["e", "f"]],
  ]);
  expect(groupByDate([{ at: at(10) }], i => i.at, now).map(g => g.label)).toEqual(["Раньше"]);
});
