// Общие классы простых страниц по макету (Беседы, Результаты, Настройки): колонка 640–760 px,
// заголовок 34 px (на телефоне 24 px, отступы 16 × 24 px), белые карточки-группы с линией,
// кнопки-«пилюли». Низ страницы оставляет место под полосу жестов iPhone.
export const PAGE = 'mx-auto flex w-full max-w-[760px] flex-col gap-5 px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-0 sm:py-11'
export const PAGE_TITLE = 'm-0 flex-1 text-[24px] leading-8 font-semibold tracking-[-0.6px] text-kumo-default sm:text-[34px] sm:leading-10 sm:tracking-[-1px]'
export const PRIMARY_PILL = 'inline-flex h-[38px] touch:h-10 shrink-0 items-center rounded-full bg-kumo-brand px-4 text-[14px] font-medium text-white transition-colors hover:bg-kumo-brand-hover'
export const SEARCH_FIELD = 'h-[46px] w-full rounded-[14px] border border-kumo-fill-hover bg-kumo-overlay px-4 text-[15px] text-kumo-default placeholder:text-kumo-inactive outline-none transition-[border-color,box-shadow] focus:border-kumo-ring focus:ring-[3px] focus:ring-kumo-ring/15'
export const GROUP_LABEL = 'm-0 px-1 pt-1.5 text-[13px] leading-4 font-normal text-kumo-subtle'
export const GROUP_CARD = 'flex flex-col overflow-hidden rounded-[18px] border border-kumo-fill bg-kumo-overlay'
export const SECONDARY_PILL = 'inline-flex h-9 touch:h-10 shrink-0 cursor-pointer items-center rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3.5 text-[14px] text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60'
export const SECTION_TITLE = 'm-0 text-[17px] leading-6 font-semibold text-kumo-default'
/** Строка карточки-группы: действие или переход, цель нажатия не меньше 52 px. */
export const GROUP_ROW = 'flex min-h-[52px] w-full cursor-pointer items-center gap-3 border-b border-kumo-tint px-[18px] py-3 text-left transition-colors last:border-b-0 hover:bg-kumo-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring'
