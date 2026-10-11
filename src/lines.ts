/** Split on \n only, drop the empty tail after a final newline, keep \r inside lines. */
export function splitLines(content: string): string[] {
  if (content === '') return [];
  const parts = content.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}
