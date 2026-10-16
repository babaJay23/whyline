import { noteShow } from './git.js';
import { hashOf, parseRecord, type Signature } from './record.js';
import { allowedSignersFile, verifySignature } from './sign.js';

export interface VerifyResult {
  sha: string;
  attached: boolean;
  hash: 'ok' | 'mismatch' | null;
  signature: 'unsigned' | 'bad' | { signer: string } | null;
}

export function verifyCommits(root: string, shas: string[], deps: { verifySig?: (hash: string, sig: Signature) => boolean } = {}): VerifyResult[] {
  const check = deps.verifySig ?? ((hash, sig) => verifySignature(hash, sig, allowedSignersFile(root)));
  return shas.map((sha) => {
    const text = noteShow(root, sha);
    const rec = text ? parseRecord(text) : null;
    if (!rec) return { sha, attached: false, hash: null, signature: null };
    const hash = hashOf(rec) === rec.hash ? 'ok' : 'mismatch';
    let signature: VerifyResult['signature'];
    if (!rec.signature) signature = 'unsigned';
    else signature = check(rec.hash, rec.signature) ? { signer: rec.signature.signer } : 'bad';
    return { sha, attached: true, hash, signature };
  });
}

export function describeResult(r: VerifyResult): string {
  const short = r.sha.slice(0, 7);
  if (!r.attached) return `${short}  missing`;
  const sig = r.signature === null ? 'signature not checked' : r.signature === 'unsigned' ? 'unsigned' : r.signature === 'bad' ? 'signature BAD' : `signed by ${r.signature.signer}`;
  return `${short}  attached  hash ${r.hash === 'ok' ? 'ok' : 'MISMATCH'}  ${sig}`;
}

export function allGood(results: VerifyResult[]): boolean {
  return results.every((r) => r.attached && r.hash === 'ok' && r.signature !== 'bad');
}
