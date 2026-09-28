// Заголовок раздела страницы по брифу: 15 px полужирный, рядом счётчик-пилюля. Без капители:
// подпись набрана обычным регистром, как остальные заголовки блоков.
export function SectionEyebrow({ label, count }: { label: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-1">
      <h2 className="m-0 text-[15px] leading-5 font-semibold text-kumo-default">
        {label}
      </h2>
      {typeof count === 'number' && (
        <span className="rounded-full bg-kumo-fill px-1.5 text-[11px] leading-[18px] font-medium text-kumo-subtle">
          {count}
        </span>
      )}
    </div>
  )
}
