// Собирает приложение «Память» (app-react) в один HTML-файл src/generated/app.txt.
// Скрипт — единственный инлайн и классический (не module): jsdom в тестах выполняет только такие,
// а CSP фрейма разрешает его по sha256 и запрещает сеть. Картинки — только blob:: фото людей скачивает
// оболочка и передаёт байтами (app-react/photos.tsx), адрес хранилища фрейму не открывается.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const packageRoot = new URL(".", import.meta.url);
const appRoot = fileURLToPath(new URL("app-react/", packageRoot));
const watch = process.argv.includes("--watch");

function finalHtml(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error(`ожидался ровно один инлайн-скрипт, найдено ${scripts.length}`);
  const script = scripts[0][1].replaceAll("</script", "<\\/script");
  const hash = createHash("sha256").update(script).digest("base64");
  const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'none'; img-src blob:; media-src blob:; base-uri 'none'; form-action 'none'; object-src 'none'`;
  // Скрипт остаётся в <head>, где его поставил Vite: тогда body.textContent в тестах — только разметка, без кода;
  // main.tsx ждёт DOMContentLoaded. Замены — функциями: в минифицированном коде встречаются «$'» и «$`»,
  // которые строковая замена трактует как шаблоны.
  return html
    .replace(scripts[0][0], () => `<script>${script}</script>`)
    .replace("<head>", () => `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
}

function emitAppText() {
  return {
    name: "mnemos-app-text",
    enforce: "post",
    async generateBundle(_options, bundle) {
      const page = Object.values(bundle).find(item => item.type === "asset" && item.fileName.endsWith(".html"));
      if (!page) throw new Error("сборка не дала index.html");
      const html = finalHtml(String(page.source));
      await mkdir(new URL("src/generated/", packageRoot), { recursive: true });
      await writeFile(new URL("src/generated/app.txt", packageRoot), html);
      console.log(`app.txt: ${(html.length / 1024).toFixed(0)} КиБ`);
      for (const key of Object.keys(bundle)) delete bundle[key];
    },
  };
}

await build({
  configFile: false,
  root: appRoot,
  logLevel: "warn",
  plugins: [react(), tailwindcss(), viteSingleFile(), emitAppText()],
  build: {
    write: false,
    target: "es2022",
    minify: "esbuild",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: { input: `${appRoot}index.html`, output: { format: "iife", entryFileNames: "app.js" } },
    watch: watch ? {} : null,
  },
});
