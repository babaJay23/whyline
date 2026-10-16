import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmp-repo.js';
import { signingKey, signHash, verifySignature, allowedSignersFile } from '../src/sign.js';

function keypair() {
  const dir = mkdtempSync(join(tmpdir(), 'whyline-key-'));
  const key = join(dir, 'id_ed25519');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', key]);
  const pub = readFileSync(key + '.pub', 'utf8').trim();
  const allowed = join(dir, 'allowed_signers');
  writeFileSync(allowed, `dev@example.com ${pub}\n`);
  return { key, pub, allowed };
}

describe('signing', () => {
  it('signs a hash and verifies it against allowed_signers', () => {
    const { key, allowed } = keypair();
    const sig = signHash('sha256:abc', key, 'dev@example.com');
    if (typeof sig === 'string') throw new Error(sig);
    expect(sig).toMatchObject({ format: 'ssh', signer: 'dev@example.com', namespace: 'whyline' });
    expect(sig.sig).toContain('-----BEGIN SSH SIGNATURE-----');
    expect(verifySignature('sha256:abc', sig, allowed)).toBe(true);
    expect(verifySignature('sha256:abd', sig, allowed)).toBe(false);
    expect(verifySignature('sha256:abc', { ...sig, signer: 'other@example.com' }, allowed)).toBe(false);
    expect(verifySignature('sha256:abc', sig, null)).toBe(false);
  });

  it('resolves the key from git config, strips .pub, and explains what is missing', () => {
    const r = makeRepo({});
    const { key } = keypair();
    expect(signingKey(r.dir)).toMatch(/git config gpg.format ssh/);
    r.git('config', 'gpg.format', 'ssh');
    r.git('config', 'user.email', 'dev@example.com');
    r.git('config', 'user.signingkey', key + '.pub');
    expect(signingKey(r.dir)).toEqual({ key, signer: 'dev@example.com' });
    r.git('config', 'user.signingkey', 'key::ssh-ed25519 AAAA');
    expect(signingKey(r.dir)).toMatch(/literal key/);
    expect(signingKey(r.dir, key)).toEqual({ key, signer: 'dev@example.com' });
    expect(allowedSignersFile(r.dir)).toBeNull();
    r.git('config', 'gpg.ssh.allowedSignersFile', '~/.ssh/allowed');
    expect(allowedSignersFile(r.dir)).toBe(join(process.env.HOME!, '.ssh', 'allowed'));
  });
});
