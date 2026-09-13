import * as Y from 'yjs';
import { FORMAT_BLUEPRINTS } from './generated/format-blueprints.js';
import { parseBlueprintArchive } from './blueprint-archive.js';

/** Load only the deployment's bundled native editor code, never document data. */
export async function nativeEditorCode(outputId: string) {
  const id = outputId === 'document' ? 'format.document' : outputId === 'spreadsheet' ? 'format.spreadsheet' : outputId === 'presentation' ? 'format.slides' : null;
  const entry = FORMAT_BLUEPRINTS.find(item => item.blueprintId === id);
  if (!entry) return null;
  const archive = await parseBlueprintArchive(new Response(Uint8Array.fromBase64(entry.archive) as BufferSource).body!);
  const bytes = await new Response(archive.content.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const doc = new Y.Doc();
  try {
    Y.applyUpdateV2(doc, new Uint8Array(bytes));
    const files = new Map([...doc.getMap<Y.Text>()].map(([name, text]) => [name, text.toString()]));
    if (!files.has('server.js') || !files.has('client.js')) throw new Error('Native editor bundle is incomplete.');
    return { revision: entry.revision, files };
  } finally { doc.destroy(); }
}

/** List replacements and removals within one gadget's code root. */
export function nativeEditorChanges(doc: Y.Doc, root: string, files: Map<string, string>): string[] {
  const current = doc.getMap<Y.Text>(root);
  return [...new Set([...current.keys(), ...files.keys()])]
    .filter(name => current.get(name)?.toString() !== files.get(name)).sort();
}

/** Produce a code-only update; other gadgets and the gadget's Durable Object data are untouched. */
export function replaceNativeEditorCode(doc: Y.Doc, root: string, files: Map<string, string>): Uint8Array {
  const before = Y.encodeStateVector(doc);
  doc.transact(() => {
    const current = doc.getMap<Y.Text>(root);
    for (const name of current.keys()) if (!files.has(name)) current.delete(name);
    for (const [name, code] of files) {
      if (current.get(name)?.toString() === code) continue;
      const text = new Y.Text(); text.insert(0, code); current.set(name, text);
    }
  });
  return Y.encodeStateAsUpdateV2(doc, before);
}
