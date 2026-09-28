/** Признак загрузки страницы: пока код раздела или его данные в пути, место страницы не пустое. */
export default function PageLoading({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 text-sm text-kumo-subtle">
      <div aria-hidden="true" className="h-7 w-7 animate-spin rounded-full border-2 border-kumo-brand border-t-transparent motion-reduce:animate-[spin_2.4s_linear_infinite]" />
      {label}
    </div>
  )
}
