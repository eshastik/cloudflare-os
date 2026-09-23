// A pending count is shown only when the app reports a positive whole number.
export function SectionCount({ count }: { count: number | undefined }) {
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) return null;
  return (
    <span data-testid="section-count" className="rounded-full bg-kumo-fill px-1.5 text-[11px] leading-4 font-medium text-kumo-subtle">
      {count > 99 ? "99+" : count}
    </span>
  );
}
