import { describe, expect, it } from "vitest";
import { markdownToTelegramHtml, telegramChunks } from "../src/telegram/format";
import { ExternalProgressRelay, PROGRESS_INTERVAL_MS, type ProgressClock } from "../src/external-progress";
import type { GadgetProgress } from "@gadgets/workshop-shared/external-message-gateway";

describe("Markdown → HTML Telegram", () => {
  it("переводит основную разметку и экранирует остальное", () => {
    expect(markdownToTelegramHtml("**жирный** и *курсив*, `a<b>` и [сайт](https://example.ru/a?b=1&c=2)"))
      .toBe("<b>жирный</b> и <i>курсив</i>, <code>a&lt;b&gt;</code> и сайт (https://example.ru/a?b=1&amp;c=2)");
    expect(markdownToTelegramHtml("# Заголовок\n- пункт\n> цитата\n> ещё")).toBe("<b>Заголовок</b>\n• пункт\n<blockquote>цитата\nещё</blockquote>");
    expect(markdownToTelegramHtml("```ts\nif (a < b) {}\n```")).toBe('<pre><code class="language-ts">if (a &lt; b) {}</code></pre>');
    expect(markdownToTelegramHtml("<script>alert(1)</script> & x")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; x");
  });

  it("адрес ссылки всегда виден: текст ссылки не прячет, куда она ведёт", () => {
    expect(markdownToTelegramHtml("[Открыть отчёт](https://evil.example/steal)")).toBe("Открыть отчёт (https://evil.example/steal)");
    expect(markdownToTelegramHtml("[x](javascript:alert(1))")).not.toContain("<a");
  });

  it("подчёркивание внутри слова — не курсив", () => {
    expect(markdownToTelegramHtml("файл report_2026_09.xlsx")).toBe("файл report_2026_09.xlsx");
  });
});

describe("нарезка по 4096", () => {
  it("каждый кусок не длиннее 4096 и текст не теряется", () => {
    let text = Array.from({ length: 40 }, (_, i) => `Абзац ${i}: ` + "слово ".repeat(80)).join("\n\n");
    let chunks = telegramChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (let chunk of chunks) {
      expect(chunk.plain.length).toBeLessThanOrEqual(4096);
      if (chunk.html !== null) expect(chunk.html.length).toBeLessThanOrEqual(4096);
    }
    let joined = chunks.map(chunk => chunk.plain).join("\n");
    for (let i = 0; i < 40; i++) expect(joined).toContain(`Абзац ${i}:`);
  });

  it("блок кода на границе закрывается и открывается снова: теги не рвутся", () => {
    let code = "```\n" + Array.from({ length: 400 }, (_, i) => `line ${i} <x>`).join("\n") + "\n```";
    let chunks = telegramChunks(code);
    expect(chunks.length).toBeGreaterThan(1);
    for (let chunk of chunks) {
      expect(chunk.html).toMatch(/^<pre><code>[\s\S]*<\/code><\/pre>$/);
      expect(chunk.html!.length).toBeLessThanOrEqual(4096);
    }
  });

  it("одна очень длинная строка режется без потери и без разрыва эмодзи", () => {
    let line = "😀".repeat(5000);
    let chunks = telegramChunks(line);
    expect(chunks.map(chunk => chunk.plain).join("")).toBe(line);
    for (let chunk of chunks) expect(chunk.plain.length).toBeLessThanOrEqual(4096);
  });

  it("много спецсимволов раздувают HTML — такой кусок уходит простым текстом", () => {
    let chunks = telegramChunks("<".repeat(3000));
    expect(chunks.every(chunk => chunk.html === null || chunk.html.length <= 4096)).toBe(true);
    expect(chunks.map(chunk => chunk.plain).join("")).toBe("<".repeat(3000));
  });
});

describe("промежуточные события хода для внешнего канала", () => {
  function fakeClock() {
    let now = 0;
    let timers: { at: number; run: () => void }[] = [];
    let clock: ProgressClock = {
      now: () => now,
      setTimeout: (run, ms) => { let timer = { at: now + ms, run }; timers.push(timer); return timer; },
      clearTimeout: handle => { timers = timers.filter(timer => timer !== handle); },
    };
    let advance = async (ms: number) => {
      now += ms;
      for (;;) {
        let due = timers.filter(timer => timer.at <= now);
        if (!due.length) break;
        timers = timers.filter(timer => !due.includes(timer));
        for (let timer of due) timer.run();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      }
    };
    return { clock, advance };
  }

  it("сотни кусков текста сворачиваются в редкие снимки с полным состоянием", async () => {
    let { clock, advance } = fakeClock();
    let sent: GadgetProgress[] = [];
    let relay = new ExternalProgressRelay(async progress => { sent.push(progress); }, clock);
    relay.push({ type: "toolCallStarted", toolCallId: "t1", toolName: "executeCode" });
    relay.push({ type: "toolCodeDelta", toolCallId: "t1", delta: "await env.MNEMOS." });
    relay.push({ type: "toolCodeDelta", toolCallId: "t1", delta: "search('x')" });
    await advance(0);
    expect(sent).toEqual([{ text: "", step: { toolName: "executeCode", code: "await env.MNEMOS.search('x')" } }]);
    for (let i = 0; i < 300; i++) relay.push({ type: "textDelta", delta: "а" });
    await advance(PROGRESS_INTERVAL_MS - 1);
    expect(sent).toHaveLength(1);
    await advance(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ text: "а".repeat(300), step: null });
    // Неинтересные события снимков не порождают; после закрытия — тишина.
    relay.push({ type: "codeReset" });
    relay.push({ type: "textDelta", delta: "б" });
    relay.close();
    await advance(PROGRESS_INTERVAL_MS * 3);
    expect(sent).toHaveLength(2);
  });
});
