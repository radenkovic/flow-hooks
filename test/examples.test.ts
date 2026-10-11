import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every example ends with an `/* Output: ... */` block. Running the example
// must print exactly that, so the examples in the docs can't go stale.
const dir = new URL('../examples/', import.meta.url);
const examples = readdirSync(dir).filter((file) => file.endsWith('.ts'));

function expectedOutput(source: string): string {
  const match = /\/\* Output:\n([\s\S]*?)\*\/\s*$/.exec(source);
  if (!match?.[1]) throw new Error('Example has no /* Output: */ block');
  return match[1].trimEnd();
}

describe('examples', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(examples)('%s prints its documented output', async (file) => {
    const url = new URL(file, dir);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    await import(url.href);
    expect(lines.join('\n')).toBe(expectedOutput(readFileSync(url, 'utf8')));
  });
});
