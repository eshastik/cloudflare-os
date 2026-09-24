// Распаковка встроенного редактора (.gadget) в обычные файлы и обратная сборка.
//
//   node scripts/format-blueprint-sources.mjs unpack format-blueprints/workspace-docs.gadget /tmp/docs
//   node scripts/format-blueprint-sources.mjs pack /tmp/docs format-blueprints/workspace-docs.gadget /tmp/docs.gadget
//
// Собранный архив дальше идёт через import:format-blueprint: он поднимает revision, и
// уже созданные документы получают новый код редактора через обновление редактора.
// Метаданные берутся из исходного архива без изменений.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import * as Y from "yjs";

const PREFIX_BYTES = 24;

function split(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadataSize = view.getUint32(12);
  const contentLength = Number(view.getBigUint64(16));
  const head = bytes.subarray(0, PREFIX_BYTES + metadataSize);
  const content = bytes.subarray(PREFIX_BYTES + metadataSize);
  if (content.byteLength !== contentLength) throw new Error(`Архив объявляет ${contentLength} байт содержимого, а в нём ${content.byteLength}.`);
  return { head, content };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

const [command, a, b, c] = process.argv.slice(2);
if (command === "unpack" && a && b) {
  const { content } = split(new Uint8Array(await readFile(a)));
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, gunzipSync(content));
  for (const [name, text] of doc.getMap()) {
    const path = join(b, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text.toString());
    console.log(name);
  }
} else if (command === "pack" && a && b && c) {
  const { head } = split(new Uint8Array(await readFile(b)));
  const doc = new Y.Doc();
  const root = doc.getMap();
  for (const path of (await walk(a)).sort()) {
    root.set(relative(a, path), new Y.Text(await readFile(path, "utf8")));
  }
  const content = gzipSync(Y.encodeStateAsUpdateV2(doc));
  const prefix = new Uint8Array(head);
  new DataView(prefix.buffer).setBigUint64(16, BigInt(content.byteLength));
  await writeFile(c, Buffer.concat([prefix, content]));
  console.log(`${c}: ${content.byteLength} байт содержимого`);
} else {
  console.error("Использование: unpack <архив> <каталог> | pack <каталог> <исходный архив> <новый архив>");
  process.exit(2);
}
