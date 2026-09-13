import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {signDriveOrigin,driveSourceBinding} from './drive-origin-proof.ts';
test('WebCrypto proof matches the Go verifier interoperability vector',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../__tests__/fixtures/drive-origin-proof.json',import.meta.url),'utf8'));
 assert.equal(await signDriveOrigin(fixture.key,fixture.claim),fixture.proof);
 assert.notEqual(await signDriveOrigin(fixture.key,{...fixture.claim,owner:'different'}),fixture.proof);
 await assert.rejects(signDriveOrigin('short',fixture.claim));
 assert.equal(await driveSourceBinding('source-key'),await driveSourceBinding('source-key'));
 assert.notEqual(await driveSourceBinding('source-key'),await driveSourceBinding('different-key'));
 assert.match(await driveSourceBinding('source-key'),/^[a-f0-9]{64}$/);
});
