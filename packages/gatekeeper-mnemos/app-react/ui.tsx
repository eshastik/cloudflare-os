import { createElement, isValidElement, type ButtonHTMLAttributes, type ElementType, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Tray } from "@phosphor-icons/react";

// Общие детали интерфейса по макету 24.09.2026: пилюли-кнопки, белые карточки радиусом 16 с линией,
// заголовок страницы 30 px, чипы и пустое состояние. Цвета — только токенами из styles.css.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-kumo-brand font-medium text-kumo-inverse hover:bg-kumo-brand-hover",
  secondary: "border border-kumo-fill-hover bg-kumo-overlay text-kumo-default hover:bg-kumo-tint",
  ghost: "border border-transparent bg-transparent text-kumo-default hover:bg-kumo-tint",
  danger: "border border-kumo-fill-hover bg-kumo-overlay text-kumo-danger hover:bg-kumo-danger-tint",
};
const BUTTON_SIZES: Record<ButtonSize, { box: string; square: string }> = {
  sm: { box: "h-8 gap-1.5 px-3.5 text-[13px]", square: "h-8 w-8" },
  md: { box: "h-[38px] gap-2 px-4 text-[14px]", square: "h-[38px] w-[38px]" },
  lg: { box: "h-11 gap-2 px-[22px] text-[15px]", square: "h-11 w-11" },
};

/**
 * Кнопка-пилюля: радиус — половина высоты. Главная — заливка акцентом, вторичная — белая с линией.
 * Подписи и поведение как у кнопки Kumo, поэтому экраны меняют только импорт.
 */
export function Button({ variant = "primary", size = "md", shape, icon, className = "", type = "button", children, ...rest }: {
  variant?: ButtonVariant; size?: ButtonSize; shape?: "square" | "circle"; icon?: ReactNode | ElementType; children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const box = shape ? `${BUTTON_SIZES[size].square} px-0` : BUTTON_SIZES[size].box;
  // Как у Kumo: значок можно передать готовым элементом или компонентом.
  const glyph = icon == null || isValidElement(icon) || typeof icon === "string" ? icon as ReactNode : createElement(icon as ElementType, { size: 16, "aria-hidden": true });
  return (
    <button type={type} {...rest}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full leading-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:opacity-50 ${box} ${BUTTON_VARIANTS[variant]} ${className}`}>
      {glyph}{children}
    </button>
  );
}

/** Заголовок страницы: 30 px, 600, трекинг −0.8; подзаголовок 15 px. На странице проекта — уровень h2. */
export function PageHeader({ title, subtitle, actions, level = 1, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; level?: 1 | 2; children?: ReactNode }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="mb-7 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <Heading className="m-0 text-[30px] leading-[36px] font-semibold tracking-[-0.8px] text-kumo-default">{title}</Heading>
        {subtitle && <p className="mt-1.5 mb-0 max-w-[680px] text-[15px] leading-[22px] text-kumo-subtle">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Белая карточка радиусом 16 с линией. Тени у карточек нет: тень только у открытого гаджета. */
export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return <div className={`rounded-[16px] border border-kumo-fill bg-kumo-overlay ${className}`} {...rest}>{children}</div>;
}

/** Заголовок секции страницы: 16 px, 600, действия справа. */
export function SectionTitle({ title, count, actions }: { title: ReactNode; count?: number | string; actions?: ReactNode }) {
  return (
    <div className="mb-2.5 flex min-h-8 flex-wrap items-center gap-2">
      <h2 className="m-0 text-[16px] leading-[22px] font-semibold text-kumo-default">{title}</h2>
      {count !== undefined && <span className="rounded-full bg-kumo-tint px-2 text-[12px] leading-5 text-kumo-subtle">{count}</span>}
      <div className="flex-1" />
      {actions}
    </div>
  );
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-kumo-tint text-kumo-subtle",
  success: "bg-selection-bg text-kumo-brand",
  brand: "bg-selection-bg text-kumo-brand",
  warning: "bg-kumo-warning-tint text-kumo-warning",
  danger: "bg-kumo-danger-tint text-kumo-danger",
  info: "bg-kumo-info-tint text-kumo-default",
};

/** Чип: высота 22, радиус 11, текст 12. «Ждёт решения» — янтарный. */
export function Chip({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex h-[22px] w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[12px] leading-4 ${TONES[tone]}`}>{children}</span>;
}

/** Прежнее имя чипа состояния; экраны админки пользуются им же. */
export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <Chip tone={tone}>{children}</Chip>;
}

/** Квадрат 40×40 со значком у строки «Входящих». */
export function IconTile({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "brand"; children: ReactNode }) {
  const color = tone === "warning" ? "bg-kumo-warning-tint text-kumo-warning" : tone === "brand" ? "bg-selection-bg text-kumo-brand" : "bg-kumo-tint text-kumo-default";
  return <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${color}`}>{children}</span>;
}

/**
 * Карточка решения: кто и что в заголовке, подробность строкой ниже, кнопки решения на месте.
 * Заголовок — кнопка, если у карточки есть подробности; тогда они раскрываются внутри неё.
 */
export function DecisionCard({ icon, tone, title, note, badge, actions, onToggle, expanded, children, ...rest }: {
  icon: ReactNode; tone?: "neutral" | "warning" | "brand"; title: ReactNode; note?: ReactNode; badge?: ReactNode; actions?: ReactNode;
  onToggle?(): void; expanded?: boolean; children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "children">) {
  return (
    <article {...rest} className="flex flex-col gap-3.5 rounded-[18px] border border-kumo-fill bg-kumo-overlay px-5 py-5 sm:px-[22px]">
      <div className="flex items-start gap-3.5">
        <IconTile tone={tone}>{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 mb-1 text-[17px] leading-[23px] font-semibold text-kumo-default">
            {onToggle
              ? <button type="button" aria-expanded={!!expanded} onClick={onToggle} className="m-0 cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit] leading-[inherit] text-kumo-default hover:text-kumo-brand">{title}</button>
              : title}
          </h3>
          {note && <p className="m-0 text-[14px] leading-[21px] text-kumo-subtle">{note}</p>}
        </div>
        {badge}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:pl-[54px]">{actions}</div>}
      {children}
    </article>
  );
}

/** Строка простого списка по макету: значок, название 15 px, справа приглушённая подпись, линия снизу. */
export function ListRow({ icon, children, meta, className = "", ...rest }: { icon?: ReactNode; children: ReactNode; meta?: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  return (
    <div className={`flex items-center gap-3 border-b border-kumo-fill px-1 py-3 text-[15px] text-kumo-default ${className}`} {...rest}>
      {icon && <span className="flex shrink-0 text-kumo-default" aria-hidden="true">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {meta}
    </div>
  );
}

export function RowList({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[16px] border border-kumo-fill bg-kumo-overlay">{children}</div>;
}

export function Row({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  return <div className={`flex items-center gap-3 border-t border-kumo-fill px-4 py-3 first:border-t-0 ${className}`} {...rest}>{children}</div>;
}

/** Основная строка и подпись строки списка. */
export function RowText({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[15px] leading-5 text-kumo-default">{title}</div>
      {note && <div className="mt-0.5 text-[13px] leading-[18px] text-kumo-subtle">{note}</div>}
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[11px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">{children}</div>;
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "danger" | "success"; children: ReactNode }) {
  const color = tone === "danger" ? "text-kumo-danger" : tone === "success" ? "text-kumo-brand" : "text-kumo-subtle";
  return <p role="status" className={`m-0 text-[14px] leading-5 ${color}`}>{children}</p>;
}

/** Пустое состояние: что здесь появится и, если есть, одно действие. */
export function EmptyState({ title = "Пока нечего показать", description, icon, action }: { title?: ReactNode; description: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[16px] border border-dashed border-kumo-fill-hover px-6 py-9 text-center">
      <span aria-hidden="true" className="mb-1 flex h-10 w-10 items-center justify-center rounded-[12px] bg-kumo-tint text-kumo-subtle">{icon ?? <Tray size={20} />}</span>
      <div className="text-[15px] font-semibold text-kumo-default">{title}</div>
      <p className="m-0 max-w-[460px] text-[14px] leading-[21px] text-kumo-subtle">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Прежнее имя пустого состояния. */
export function EmptyTab({ description }: { description: string }) {
  return <EmptyState description={description} />;
}

/** Секция страницы: заголовок со счётчиком, действия справа, содержимое. Пустая секция не исчезает — показывает empty. */
export function Block({ title, count, actions, empty, children, id }: { title: string; count?: number; actions?: ReactNode; empty?: string; children?: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="mb-7">
      <SectionTitle title={title} count={count} actions={actions} />
      {empty !== undefined && count === 0 ? <Notice>{empty}</Notice> : children}
    </section>
  );
}

/** Служебные идентификаторы для администратора — свёрнуты под «Подробнее»; остальным не показываются. */
export function AdminDetails({ show, items }: { show: boolean; items: [string, string | undefined][] }) {
  const shown = items.filter((item): item is [string, string] => !!item[1]);
  if (!show || shown.length === 0) return null;
  return (
    <details data-admin-details="" className="mt-2 text-[12px] text-kumo-subtle">
      <summary className="cursor-pointer select-none">Подробнее</summary>
      <div className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {shown.map(([label, value]) => <div key={label} className="contents"><span>{label}</span><span className="break-all font-mono">{value}</span></div>)}
      </div>
    </details>
  );
}

/**
 * Замена тегу form. Фрейм приложения — песочница без allow-forms: браузер не отправляет формы и не
 * вызывает onSubmit (jsdom этого не соблюдает, поэтому тесты с формами зеленели). Действие запускает
 * кнопка type="button" или Enter в однострочном поле; onAction сам проверяет, можно ли действовать.
 */
export function ActionForm({ onAction, children, className, ...rest }: { onAction(): void; children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, "onKeyDown" | "children" | "className" | "role">) {
  return <div role="form" className={className} {...rest} onKeyDown={e => {
    const target = e.target as HTMLElement;
    if (e.key !== "Enter" || e.nativeEvent.isComposing || target.tagName !== "INPUT") return;
    if (["checkbox", "radio", "button", "submit", "reset", "file"].includes((target as HTMLInputElement).type)) return;
    e.preventDefault();
    onAction();
  }}>{children}</div>;
}

const inputClass = "h-[38px] rounded-[12px] border border-kumo-fill-hover bg-kumo-control px-3 text-[14px] text-kumo-default outline-none focus:border-kumo-ring disabled:opacity-60";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} px-2.5 ${props.className ?? ""}`} />;
}

/** Многострочное поле того же вида. */
export const textAreaClass = "w-full resize-y rounded-[12px] border border-kumo-fill-hover bg-kumo-control p-3 text-[14px] leading-5 text-kumo-default outline-none focus:border-kumo-ring disabled:opacity-60";
