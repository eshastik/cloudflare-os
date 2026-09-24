// A pending count is shown only when the app reports a positive whole number.
// Число в меню — сигнал «ждёт вашего решения», поэтому оно окрашено цветом предупреждения.
export function SectionCount({ count }: { count: number | undefined }) {
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) return null;
  return (
    <span data-testid="section-count" className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-kumo-warning px-1.5 text-[12px] leading-none font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
