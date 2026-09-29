// Выбранный акцент меняет всё, что было фирменным зелёным: акцентные токены, оттенок нейтральных
// поверхностей и встроенные редакторы. Зелёный остаётся только у статуса «успех».
// Vitest идёт под node, а tsconfig src знает только типы браузера (как в rpcErrors.test.ts).
// @ts-expect-error node builtin without @types/node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from "vitest";
import { ACCENT_PALETTE, accentCSSVariables, accentLuminance, accentShades, gadgetAccentVariables, hexToOklch, oklchToHex } from "@gadgets/workshop-shared/accent-theme";
import { ACCENT_TOKENS, accentViolations, defaultAccentHue, greenLiterals, isBrandGreenHex } from "@gadgets/workshop-shared/accent-audit";
import { hostRootAttributes, hostThemeVariables } from "./gadgetHostTheme";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const contrast = (a: string, b: string) => { const x = accentLuminance(a), y = accentLuminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe("акцент оболочки", () => {
  it("styles.css не держит зашитого зелёного: нейтральные токены окрашены оттенком акцента в обеих темах", () => {
    expect(accentViolations(css)).toEqual([]);
  });

  it("зелёные значения по умолчанию есть только у токенов, которые скрипт переопределяет на корне", () => {
    const keys = Object.keys(accentCSSVariables("#ae4b14"));
    for (const token of ACCENT_TOKENS) expect(keys, token).toContain(token);
    expect(keys).toEqual(expect.arrayContaining(["--accent-hue", "--accent-neutral-tint"]));
  });

  it("оттенок нейтральных поверхностей до запуска скрипта совпадает с зелёным Mnemos", () => {
    expect(defaultAccentHue(css)).toBeCloseTo(hexToOklch(ACCENT_PALETTE[0].color)[2], 0);
  });

  it("оттенок нейтральных поверхностей берётся у выбранного цвета; серый цвет их не окрашивает", () => {
    const orange = accentCSSVariables("#ae4b14");
    expect(Number(orange["--accent-hue"])).toBeCloseTo(44.6, 0);
    expect(orange["--accent-neutral-tint"]).toBe("1");
    expect(accentCSSVariables("#555555")["--accent-neutral-tint"]).toBe("0");
    expect(Number(accentCSSVariables("#526477")["--accent-neutral-tint"])).toBeGreaterThan(0.9);
  });

  it("текст акцента читается на окрашенных поверхностях обеих тем", () => {
    for (const option of ACCENT_PALETTE) {
      const s = accentShades(option.color);
      // Светлая «подложка» (kumo-tint) и тёмная (kumo-tint, на ней стоят активные пункты).
      expect(contrast(s.lightText, oklchToHex(0.9567, 0.0079, s.hue)), option.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.darkText, oklchToHex(0.225, 0.025, s.hue)), option.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.brand, "#ffffff"), option.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("перевод OKLCH туда и обратно не теряет цвет", () => {
    for (const option of ACCENT_PALETTE) expect(oklchToHex(...hexToOklch(option.color))).toBe(option.color);
  });

  it("признак загрузки до запуска скрипта нейтральный, без зелёного", () => {
    expect(greenLiterals(indexHtml)).toEqual([]);
  });

  it("редактор во фрейме получает оттенки акцента только как HEX, светлые — под прежними именами", () => {
    const vars = hostThemeVariables("#ae4b14");
    expect(vars).toMatchObject(gadgetAccentVariables("#ae4b14"));
    for (const [name, value] of Object.entries(vars)) {
      if (name === "--host-accent-hue" || name === "--host-neutral-tint") continue;
      expect(value).toMatch(/^#[0-9a-f]{6}$/); expect(isBrandGreenHex(value)).toBe(false);
    }
    expect(hostRootAttributes({ mode: "light", accent: "#ae4b14" })).toBe(` data-mode="light" style="${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}"`);
    // Не HEX — действует зелёный Mnemos, чужой CSS в разметку не попадает.
    expect(hostRootAttributes({ mode: "dark", accent: "red;background:url(x)" })).toBe(hostRootAttributes({ mode: "dark", accent: null }));
    expect(hostRootAttributes({ mode: "dark", accent: null })).not.toContain("url(");
  });
});
