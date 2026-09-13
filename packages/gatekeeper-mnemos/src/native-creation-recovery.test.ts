import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeCreationRecovery } from './native-creation-recovery.ts';
import type { AccountStorage } from './account-session.ts';
function storage(): AccountStorage {
  const values = new Map<string, unknown>([['mnemosAccountOwner',{tenant:'tenant',user:'human'}]]);
  return { get: <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: (key, value) => { values.set(key, structuredClone(value)); }, delete: key => { values.delete(key); } };
}
test('creation receipts survive controller recreation and reject another account, format or tampering', async () => {
  const owner = storage();
  const intent = { project: 'project', name: 'Приватный документ', format: 'cloudflareos.document' as const,
    head: 'a'.repeat(64), request: crypto.randomUUID(), upload: 'owned-upload' };
  const receipts = await Promise.all([new NativeCreationRecovery(owner).seal(intent), new NativeCreationRecovery(owner).seal(intent)]);
  for (const receipt of receipts) {
    assert.deepEqual(await new NativeCreationRecovery(owner).open(receipt, intent.format), intent);
    await assert.rejects(new NativeCreationRecovery(storage()).open(receipt, intent.format));
    const other = new NativeCreationRecovery(storage()); await other.seal(intent);
    await assert.rejects(other.open(receipt, intent.format));
    await assert.rejects(new NativeCreationRecovery(owner).open(receipt, 'cloudflareos.spreadsheet'));
    await assert.rejects(new NativeCreationRecovery(owner).open((receipt[0] === 'A' ? 'B' : 'A') + receipt.slice(1), intent.format));
  }
});

test('office creation recovery retains the preview and explicit loss acceptance', async () => {
  const owner = storage();
  const intent = {project:'p',name:'Copy.cfdoc',format:'cloudflareos.document' as const,head:'a'.repeat(64),request:crypto.randomUUID(),upload:'u',officePreview:'server-preview',acceptUnsupported:true};
  const receipt = await new NativeCreationRecovery(owner).seal(intent);
  assert.deepEqual(await new NativeCreationRecovery(owner).open(receipt,intent.format),intent);
});
