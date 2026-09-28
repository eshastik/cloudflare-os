// Проверка таблиц стилей на зашитый зелёный Mnemos. Используется тестами оболочки и панели Mnemos:
// выбранный акцент должен менять всё, что было фирменным зелёным.
// Модуль без импортов: его читают и vitest оболочки, и node --test панели Mnemos.

/** Зелёный Mnemos по условию проверки: оттенок sRGB 140–175°, насыщенность HSL > 0.25. */
export function isBrandGreenHex(hex: string): boolean {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d || max !== g) return false;
  const l = (max + min) / 510, s = d / 255 / (1 - Math.abs(2 * l - 1)), hue = 60 * ((b - r) / d + 2);
  return s > 0.25 && hue >= 140 && hue <= 175;
}

/** Цвета, которые по-прежнему фирменные после смены акцента: должны браться из акцента или статуса. */
export const ACCENT_TOKENS = [
  "--color-kumo-brand", "--color-kumo-brand-hover", "--color-kumo-ring", "--text-color-kumo-brand", "--text-color-kumo-link",
  "--color-accent-100", "--color-accent-200", "--color-selection-bg", "--color-selection-text",
] as const;
/** Семантика «успех» и категория ИИ: зелёные по смыслу, акцент их не трогает. */
export const SEMANTIC_GREEN_TOKENS = [
  "--color-kumo-success", "--color-kumo-success-tint", "--text-color-kumo-success", "--color-status-live", "--color-ai-100", "--color-ai-200",
] as const;
/** Нейтральные поверхности, линии и текст: оттенок обязан идти от акцента. */
export const TINTED_NEUTRAL_TOKENS = [
  "--color-kumo-base", "--color-kumo-elevated", "--color-kumo-tint", "--color-kumo-recessed", "--color-kumo-fill", "--color-kumo-fill-hover",
  "--color-kumo-interact", "--color-kumo-line", "--text-color-kumo-default", "--text-color-kumo-strong", "--text-color-kumo-subtle", "--text-color-kumo-inactive",
] as const;

export interface Declaration { block: "light" | "dark" | "other"; name: string; value: string }

/** Объявления переменных: блок @theme — светлая тема, [data-mode="dark"] — тёмная. */
export function cssDeclarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector, body] of blocks) {
    const block = /@theme/.test(selector) ? "light" : /\[data-mode="dark"\]\s*$/.test(selector.trim()) ? "dark" : "other";
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.push({ block, name: m[1], value: m[2].trim() });
  }
  return out;
}

/** Зелёные литералы в значении: HEX, rgb() и oklch() с оттенком 135–185 и заметной хромой. */
export function greenLiterals(value: string): string[] {
  const hits: string[] = [];
  for (const m of value.matchAll(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b|#[0-9a-f]{3}\b/gi)) if (isBrandGreenHex(m[0])) hits.push(m[0]);
  for (const m of value.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) {
    const hex = "#" + [m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, "0")).join("");
    if (isBrandGreenHex(hex)) hits.push(m[0]);
  }
  for (const m of value.matchAll(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/gi)) if (Number(m[2]) > 0.02 && Number(m[3]) >= 135 && Number(m[3]) <= 185) hits.push(m[0] + ")");
  return hits;
}

/** Нарушения в таблице стилей: зашитый зелёный вне семантики и неокрашенные акцентом нейтральные токены.
 * Токены акцента с зелёным значением по умолчанию допустимы: скрипт переопределяет их на корне. */
export function accentViolations(css: string): string[] {
  const out: string[] = [];
  const allowed = new Set<string>([...ACCENT_TOKENS, ...SEMANTIC_GREEN_TOKENS]);
  const decls = cssDeclarations(css);
  for (const d of decls) {
    if (!allowed.has(d.name)) for (const hit of greenLiterals(d.value)) out.push(`${d.block} ${d.name}: ${hit}`);
    if ((d.block === "light" || d.block === "dark") && (TINTED_NEUTRAL_TOKENS as readonly string[]).includes(d.name) && !d.value.includes("var(--accent-hue)"))
      out.push(`${d.block} ${d.name}: оттенок не от акцента (${d.value})`);
  }
  for (const name of TINTED_NEUTRAL_TOKENS) for (const block of ["light", "dark"] as const)
    if (!decls.some(d => d.block === block && d.name === name)) out.push(`${block} ${name}: нет объявления`);
  // Правила вне объявлений переменных: любой зелёный литерал — нарушение.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[\w-]+\s*:[^;]+;/g, "");
  for (const hit of greenLiterals(rules)) out.push(`правило: ${hit}`);
  return out;
}

/** Оттенок нейтральных токенов по умолчанию должен совпадать с зелёным Mnemos (до запуска скрипта). */
export function defaultAccentHue(css: string): number | null {
  const m = css.match(/--accent-hue:\s*([\d.]+)\s*;/);
  return m ? Number(m[1]) : null;
}
