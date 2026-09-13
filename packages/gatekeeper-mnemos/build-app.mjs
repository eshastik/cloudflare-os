import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
const packageRoot = new URL(".", import.meta.url);
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const options = { absWorkingDir: fileURLToPath(packageRoot), entryPoints: ["app/main.ts"], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", minify: true };
async function emitHtml(output) {
const script = output.outputFiles[0].text.replaceAll("</script", "<\\/script");
const scriptHash = createHash("sha256").update(script).digest("base64");
const policy = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; connect-src 'none'; media-src blob:; base-uri 'none'; form-action 'none'; object-src 'none'`;
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mnemos — корпоративная память</title><style>:root{font:15px system-ui;color-scheme:light dark}body{margin:0;padding:24px}main{max-width:850px;margin:auto}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}p{line-height:1.5}ul{list-style:none;padding:0}li{padding:16px;border:1px solid #8885;border-radius:10px;margin:12px 0;overflow-wrap:anywhere}button{font:inherit;padding:8px 12px;margin:4px 8px 4px 0;border:1px solid #8888;border-radius:6px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible{outline:3px solid #497af0}</style><main id="app"></main><script>${script}</script></html>`;
await mkdir(new URL("src/generated/", packageRoot), { recursive: true });
await writeFile(new URL("src/generated/app.txt", packageRoot), html);

}
if (process.argv.includes("--watch")) {
  const builder = await context({ ...options, plugins: [{ name: "mnemos-html", setup(build) {
    build.onEnd(async result => { if (!result.errors.length) await emitHtml(result); });
  } }] });
  await builder.watch();
} else {
  await emitHtml(await build(options));
}
