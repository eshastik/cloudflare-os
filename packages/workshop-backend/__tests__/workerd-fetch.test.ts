import { describe, expect, it } from "vitest";

// workerd отвергает fetch с redirect: "error" (TypeError), а Node его принимает: тесты не видели
// сбоя, и 29.09 ни одна версия гаджета не читалась оболочкой. Серверный код — только "manual".
const sources = import.meta.glob(["../src/**/*.ts", "!../src/**/*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("fetch в серверном коде оболочки", () => {
  it("не использует redirect: \"error\"", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const offenders = Object.entries(sources).filter(([, text]) => /redirect\s*:\s*["']error["']/.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
