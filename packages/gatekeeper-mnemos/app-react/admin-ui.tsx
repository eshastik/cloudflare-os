import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

// Элементы страниц администратора по макету 24.09.2026: кнопки-пилюли, белые карточки со строками,
// поля высотой 42 px. Общий ui.tsx ведёт другой экран; здесь — только то, чего в нём нет.

type PillTone = "primary" | "secondary" | "ghost" | "danger";

const PILL: Record<PillTone, string> = {
  primary: "border border-transparent bg-kumo-brand text-white hover:bg-kumo-brand-hover",
  secondary: "border border-kumo-fill-hover bg-kumo-overlay text-kumo-default hover:bg-kumo-tint",
  ghost: "border border-transparent bg-transparent text-kumo-default hover:bg-kumo-tint",
  danger: "border border-transparent bg-transparent text-kumo-danger hover:bg-kumo-danger-tint",
};

/** Кнопка-пилюля: радиус — половина высоты. */
export function Pill({ tone = "secondary", size = "sm", className = "", type = "button", ...rest }: { tone?: PillTone; size?: "sm" | "md" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const height = size === "md" ? "h-10 px-[18px] text-[14px]" : "h-8 px-3 text-[13px]";
  return <button type={type} {...rest} className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${height} ${PILL[tone]} ${className}`} />;
}

/** Белая карточка со строками. */
export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  return <div className={`overflow-hidden rounded-2xl border border-kumo-fill bg-kumo-overlay ${className}`} {...rest}>{children}</div>;
}

/** Строка карточки; первая — без верхней линии. */
export function CardRow({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  return <div className={`flex items-center gap-3 border-t border-kumo-fill px-4 py-3 first:border-t-0 ${className}`} {...rest}>{children}</div>;
}

/** Название строки и подпись под ним. */
export function RowTitle({ title, note, noteTone = "subtle" }: { title: ReactNode; note?: ReactNode; noteTone?: "subtle" | "warning" | "danger" }) {
  const color = noteTone === "warning" ? "text-kumo-warning" : noteTone === "danger" ? "text-kumo-danger" : "text-kumo-subtle";
  return <span className="block min-w-0 flex-1">
    <span className="block break-words text-[15px] font-medium text-kumo-default">{title}</span>
    {note && <span className={`block text-[13px] ${color}`}>{note}</span>}
  </span>;
}

/** Заголовок секции страницы (17 px) и действия справа. */
export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
    <h2 className="m-0 flex-1 text-[17px] font-semibold text-kumo-default">{title}</h2>
    {children}
  </div>;
}

const FIELD = "h-[42px] w-full rounded-xl border border-kumo-fill-hover bg-kumo-overlay px-3 text-[15px] text-kumo-default outline-none focus:border-kumo-ring disabled:opacity-60";

/** Подписанное поле: подпись 13 px над полем. */
export function Field({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <label className={`flex min-w-0 flex-col gap-1.5 text-[13px] text-kumo-subtle ${className}`}>{label}{children}</label>;
}
export function FieldInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD} ${props.className ?? ""}`} />;
}
export function FieldSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD} px-2.5 ${props.className ?? ""}`} />;
}

/** Небольшое поле-пилюля для поиска и фильтров в заголовке секции. */
export function PillInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-8 rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 text-[13px] text-kumo-default outline-none focus:border-kumo-ring ${props.className ?? ""}`} />;
}
export function PillSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-8 rounded-full border border-kumo-fill-hover bg-kumo-overlay px-2.5 text-[13px] text-kumo-default outline-none focus:border-kumo-ring ${props.className ?? ""}`} />;
}

/** Метка-чип (компетенция и т. п.). */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-[26px] items-center gap-1 rounded-full bg-kumo-tint px-2.5 text-[13px] text-kumo-brand">{children}</span>;
}

/** Склонение по числу: 1 проект, 2 проекта, 5 проектов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}
