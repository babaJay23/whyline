import { noteShow } from './git.js';
import { hashOf, parseRecord, type Signature } from './record.js';
import { allowedSignersFile, verifySignature } from './sign.js';

export interface VerifyResult {
  sha: string;
  attached: boolean;
  /** 'wrong-commit': the note is intact but describes another commit (e.g. copied by notes.rewriteRef). */
  hash: 'ok' | 'mismatch' | 'wrong-commit' | null;
  /** 'unverifiable': signed, but this machine has no gpg.ssh.allowedSignersFile to check against. */
  signature: 'unsigned' | 'bad' | 'unverifiable' | { signer: string } | null;
  recordCommit?: string;
}

export function verifyCommits(root: string, shas: string[], deps: { verifySig?: (hash: string, sig: Signature) => boolean } = {}): VerifyResult[] {
  const allowed = allowedSignersFile(root);
  const check = deps.verifySig ?? ((hash, sig) => verifySignature(hash, sig, allowed));
  return shas.map((sha) => {
    const text = noteShow(root, sha);
    const rec = text ? parseRecord(text) : null;
    if (!rec) return { sha, attached: false, hash: null, signature: null };
    const hash = rec.commit !== sha ? 'wrong-commit' : hashOf(rec) === rec.hash ? 'ok' : 'mismatch';
    let signature: VerifyResult['signature'];
    if (!rec.signature) signature = 'unsigned';
    else if (!deps.verifySig && !allowed) signature = 'unverifiable';
    else signature = check(rec.hash, rec.signature) ? { signer: rec.signature.signer } : 'bad';
    return rec.commit !== sha ? { sha, attached: true, hash, signature, recordCommit: rec.commit } : { sha, attached: true, hash, signature };
  });
}

export function describeResult(r: VerifyResult): string {
  const short = r.sha.slice(0, 7);
  if (!r.attached) return `${short}  missing`;
  const sig = r.signature === null ? 'signature not checked'
    : r.signature === 'unsigned' ? 'unsigned'
    : r.signature === 'bad' ? 'signature BAD'
    : r.signature === 'unverifiable' ? 'signature unverifiable (no gpg.ssh.allowedSignersFile)'
    : `signed by ${r.signature.signer}`;
  const hash = r.hash === 'ok' ? 'hash ok' : r.hash === 'wrong-commit' ? `record is for ${(r.recordCommit ?? '').slice(0, 7)}` : 'hash MISMATCH';
  return `${short}  attached  ${hash}  ${sig}`;
}

export function allGood(results: VerifyResult[]): boolean {
  return results.every((r) => r.attached && r.hash === 'ok' && r.signature !== 'bad' && r.signature !== 'unverifiable');
}
