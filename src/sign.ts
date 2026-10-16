import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { configGet } from './git.js';
import type { Signature } from './record.js';

const NAMESPACE = 'whyline';
const HOWTO = 'run: git config gpg.format ssh && git config user.signingkey ~/.ssh/id_ed25519';

/** The private key git is configured to sign with, and the principal that identifies it in allowed_signers. */
export function signingKey(root: string, override?: string): { key: string; signer: string } | string {
  const signer = configGet(root, 'user.email') ?? '';
  if (!signer) return `no user.email in git config; ${HOWTO}`;
  if (override) return { key: expand(override), signer };
  if (configGet(root, 'gpg.format') !== 'ssh') return `signing needs an ssh key; ${HOWTO}`;
  const raw = configGet(root, 'user.signingkey');
  if (!raw) return `no user.signingkey in git config; ${HOWTO}`;
  if (raw.startsWith('key::') || raw.startsWith('ssh-')) return 'user.signingkey is a literal key; whyline needs the private key path (or pass --key <path>)';
  return { key: expand(raw.replace(/\.pub$/, '')), signer };
}

export function signHash(hash: string, key: string, signer: string): Signature | string {
  try {
    const sig = execFileSync('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', NAMESPACE, '-q', '-'], { input: hash, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { format: 'ssh', signer, namespace: NAMESPACE, sig };
  } catch (e) {
    return ((e as { stderr?: string }).stderr ?? (e as Error).message).trim();
  }
}

export function verifySignature(hash: string, sig: Signature, allowedSigners: string | null): boolean {
  if (!allowedSigners || sig.format !== 'ssh') return false;
  const dir = mkdtempSync(join(tmpdir(), 'whyline-sig-'));
  try {
    const sigFile = join(dir, 'record.sig');
    writeFileSync(sigFile, sig.sig);
    execFileSync('ssh-keygen', ['-Y', 'verify', '-f', allowedSigners, '-I', sig.signer, '-n', NAMESPACE, '-s', sigFile], { input: hash, stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function allowedSignersFile(root: string): string | null {
  const v = configGet(root, 'gpg.ssh.allowedSignersFile');
  return v ? expand(v) : null;
}

function expand(p: string): string {
  return resolve(p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
}
