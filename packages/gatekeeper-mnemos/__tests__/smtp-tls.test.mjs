import {test} from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

test('SMTP submission over TLS and STARTTLS', {timeout:15000}, () => {
  const directory=mkdtempSync(join(tmpdir(),'mnemos-smtp-'));
  try {
    const cert=join(directory,'cert.pem'),key=join(directory,'key.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',key,'-out',cert],{stdio:'ignore',timeout:5000});
    const child=spawnSync(process.execPath,[new URL('./smtp-tls-protocol.mjs',import.meta.url).pathname,cert,key],{
      env:{...process.env,NODE_EXTRA_CA_CERTS:cert},encoding:'utf8',timeout:10000,
    });
    assert.equal(child.status,0,child.stderr || child.stdout);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
