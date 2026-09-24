// Общие классы простых страниц по макету (Беседы, Результаты, Настройки): колонка 640–760 px,
// заголовок 34 px, белые карточки-группы с линией, кнопки-«пилюли».
export const PAGE = 'mx-auto flex w-full max-w-[760px] flex-col gap-5 px-4 py-11 sm:px-0'
export const PAGE_TITLE = 'm-0 flex-1 text-[34px] leading-10 font-semibold tracking-[-1px] text-kumo-default'
export const PRIMARY_PILL = 'inline-flex h-[38px] shrink-0 items-center rounded-full bg-kumo-brand px-4 text-[14px] font-medium text-white transition-colors hover:bg-kumo-brand-hover'
export const SEARCH_FIELD = 'h-[46px] w-full rounded-[14px] border border-kumo-fill-hover bg-kumo-overlay px-4 text-[15px] text-kumo-default placeholder:text-kumo-inactive outline-none transition-[border-color,box-shadow] focus:border-kumo-ring focus:ring-[3px] focus:ring-kumo-ring/15'
export const GROUP_LABEL = 'm-0 px-1 pt-1.5 text-[13px] leading-4 font-normal text-kumo-subtle'
export const GROUP_CARD = 'flex flex-col overflow-hidden rounded-[18px] border border-kumo-fill bg-kumo-overlay'
export const SECONDARY_PILL = 'inline-flex h-9 shrink-0 cursor-pointer items-center rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3.5 text-[14px] text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60'
export const SECTION_TITLE = 'm-0 text-[17px] leading-6 font-semibold text-kumo-default'
