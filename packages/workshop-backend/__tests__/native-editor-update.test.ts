import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { nativeEditorCode, nativeEditorChanges, replaceNativeEditorCode } from '../src/native-editor-update.js';

it('updates only the selected native code root, including removed custom files', async () => {
  const target = await nativeEditorCode('spreadsheet');
  expect(target).not.toBeNull();
  const old = new Y.Doc();
  const text = (value: string) => { const t = new Y.Text(); t.insert(0, value); return t; };
  old.getMap<Y.Text>('7').set('client.js', text('old code'));
  old.getMap<Y.Text>('7').set('custom.js', text('custom code'));
  old.getMap<Y.Text>('8').set('server.js', text('another gadget'));
  const replica = new Y.Doc(); Y.applyUpdateV2(replica, Y.encodeStateAsUpdateV2(old));
  expect(nativeEditorChanges(old, '7', target!.files)).toContain('custom.js');
  const update = replaceNativeEditorCode(old, '7', target!.files);
  Y.applyUpdateV2(replica, update);
  expect(replica.getMap<Y.Text>('8').get('server.js')?.toString()).toBe('another gadget');
  expect(replica.getMap<Y.Text>('7').has('custom.js')).toBe(false);
  expect(replica.getMap<Y.Text>('7').get('server.js')?.toString()).toBe(target!.files.get('server.js'));
  expect(replica.getMap<Y.Text>('7').get('client.js')?.toString()).toContain('acknowledgeCell');
  expect(nativeEditorChanges(replica, '7', target!.files)).toEqual([]);
  expect(await nativeEditorCode('app')).toBeNull();
  old.destroy(); replica.destroy();
});
