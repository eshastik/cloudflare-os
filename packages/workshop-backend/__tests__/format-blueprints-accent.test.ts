import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { parseBlueprintArchive } from "../src/blueprint-archive.js";
import { FORMAT_BLUEPRINTS } from "../src/generated/format-blueprints.js";

// Встроенные редакторы получают акцент оболочки переменными --host-accent* (GadgetUI.tsx).
// Зелёный Mnemos допустим только запасным значением этих переменных и в цветах самих слайдов:
// они хранятся в данных презентации и не должны меняться от личного выбора зрителя.

async function readClientCode(entry: (typeof FORMAT_BLUEPRINTS)[number]): Promise<string> {
  const archive = new Response(Uint8Array.fromBase64(entry.archive) as BufferSource).body!;
  const {content} = await parseBlueprintArchive(archive);
  const update = new Uint8Array(await new Response(content.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, update);
  return doc.getMap<Y.Text>().get("client.js")?.toString() ?? "";
}

const BRAND = /#1D6A50|#154F3B|#2F8466|rgba\(29,\s*106,\s*80/gi;

/** Убирает разрешённые места: запасные значения --host-accent* и палитру содержимого слайдов. */
function chromeWithoutAllowed(code: string): string {
  return code
    .replace(/var\(--host-accent(?:-hover|-text|-tint)?,\s*#[0-9a-f]{6}\)/gi, "")
    .replace(/const P = \{[\s\S]*?\n\};/, "")
    .replace(/const COVER_BRAND_SVG = `[^`]*`;/, "")
    .replace(/const BRAND_BAR_SVG = `[^`]*`;/, "")
    .replace(/\/\*[^*]*#154F3B[^*]*\*\//g, "")
    .replace(/const isBrandBar = [^;]*;/, "")
    .replace(/"linear-gradient\(90deg, #154F3B[^"]*"/g, "");
}

describe("акцент во встроенных редакторах", () => {
  for (const entry of FORMAT_BLUEPRINTS) {
    it(`${entry.blueprintId}: интерфейс редактора берёт акцент оболочки`, async () => {
      const code = await readClientCode(entry);
      expect(code).toContain("var(--host-accent,");
      expect(chromeWithoutAllowed(code).match(BRAND) ?? []).toEqual([]);
    });
  }
});
