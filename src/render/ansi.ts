const wrap = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`;
const id = (s: string) => s;

export function paint(enabled: boolean) {
  if (!enabled) return { bold: id, dim: id, red: id, yellow: id, green: id, cyan: id };
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39), green: wrap(32, 39), cyan: wrap(36, 39) };
}

export function colorEnabled(flagNoColor: boolean, stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  if (flagNoColor || env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined) return true;
  return stream.isTTY === true;
}
