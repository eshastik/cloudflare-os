/** Parse USD without floating point or rounding; at most six fractional digits. */
export function parseBudgetUSD(text: string): string {
 const value = text.trim().replace(",", ".");
 if (value.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("Укажите сумму USD с точностью до шести знаков.");
 const [whole, fraction = ""] = value.split(".");
 const micros = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, "0"));
 if (micros > 9223372036854775807n) throw new Error("Сумма слишком велика.");
 return micros.toString();
}
/** Format an exact micro-USD amount without converting it to Number. */
export function formatBudgetUSD(micros: string): string {
 if (!/^\d{1,19}$/.test(micros)) throw new Error("Некорректная сумма бюджета.");
 const amount = BigInt(micros);
 if (amount > 9223372036854775807n) throw new Error("Некорректная сумма бюджета.");
 const fraction = (amount % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
 return (amount / 1000000n).toString() + (fraction ? "." + fraction : "");
}
