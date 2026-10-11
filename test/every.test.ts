import { describe, expect, it, vi } from 'vitest';
import { CancelError, every, flow, runFlow } from '../src';
import { aborted, deferred } from './helpers';

describe('every()', () => {
  it('runs all hooks, waits for them and merges their contexts', async () => {
    const slow = deferred();
    const promise = flow([
      () => ({ a: true }),
      every([
        async (ctx) => {
          await slow.promise;
          return { ...ctx, slow: true };
        },
        (ctx) => ({ ...ctx, fast: true }),
      ]),
      (ctx) => ({ ...ctx, after: true }),
    ]);
    slow.resolve();
    await expect(promise).resolves.toEqual({
      a: true,
      slow: true,
      fast: true,
      after: true,
    });
  });

  it('starts every hook before any of them settles', async () => {
    const calls: string[] = [];
    const gate = deferred();
    const promise = flow([
      every([
        async () => {
          calls.push('a');
          await gate.promise;
        },
        async () => {
          calls.push('b');
          await gate.promise;
        },
      ]),
    ]);
    await vi.waitFor(() => {
      expect(calls).toEqual(['a', 'b']);
    });
    gate.resolve();
    await promise;
  });

  it('keeps the same context for an empty array or when no hook returns one', async () => {
    const initial = await flow([() => ({ a: 1 })]);
    await expect(flow([every([])], initial)).resolves.toBe(initial);
    await expect(
      flow([every([() => undefined, () => undefined])], initial),
    ).resolves.toBe(initial);
  });

  describe('merging', () => {
    it('does not let a hook undo changes made by an earlier one', async () => {
      // Both hooks spread the same starting context; only their changes count.
      const result = await flow(
        [
          every([
            (ctx) => ({ ...ctx, count: ctx.count + 1 }),
            (ctx) => ({ ...ctx, user: 'dan' }),
          ]),
        ],
        { count: 0, user: null },
      );
      expect(result).toEqual({ count: 1, user: 'dan' });
    });

    it('applies keys a hook removed', async () => {
      const result = await flow(
        [
          every([
            (ctx) => {
              const { draft, ...rest } = ctx;
              return rest;
            },
            (ctx) => ({ ...ctx, saved: true }),
          ]),
        ],
        { draft: 'x', id: 1 },
      );
      expect(result).toEqual({ id: 1, saved: true });
    });

    it('lets the later hook win when two change the same key', async () => {
      const result = await flow(
        [
          every([
            (ctx) => ({ ...ctx, value: 'first' }),
            (ctx) => ({ ...ctx, value: 'second' }),
          ]),
        ],
        { value: 'base' },
      );
      expect(result).toEqual({ value: 'second' });
    });

    it('adds keys that are set to undefined and merges symbol keys', async () => {
      const tag = Symbol('tag');
      const result = await flow([
        every([
          (ctx) => ({ ...ctx, empty: undefined }),
          (ctx) => ({ ...ctx, [tag]: true }),
        ]),
      ]);
      expect(Object.hasOwn(result, 'empty')).toBe(true);
      expect((result as Record<symbol, unknown>)[tag]).toBe(true);
    });
  });

  it.each([
    [
      'sync',
      () => {
        throw new Error('broken');
      },
    ],
    ['async', () => Promise.reject(new Error('broken'))],
  ])(
    'rejects with the first (%s) error and stops the flow',
    async (_, failing) => {
      const after = vi.fn();
      const sibling = vi.fn();
      await expect(flow([every([failing, sibling]), after])).rejects.toThrow(
        'broken',
      );
      // Siblings still start: every() runs its hooks in parallel.
      expect(sibling).toHaveBeenCalledTimes(1);
      expect(after).not.toHaveBeenCalled();
    },
  );

  it('rejects when a hook returns something that is not a context', async () => {
    await expect(flow([every([() => undefined, () => [1]])])).rejects.toThrow(
      'every() hook at index 1 must return a new context object or undefined, got an array',
    );
  });

  it('aborts the other hooks when one fails', async () => {
    let siblingSignal: AbortSignal | undefined;
    const siblingAborted = deferred();
    await expect(
      flow([
        every([
          async (_ctx, { signal }) => {
            siblingSignal = signal;
            await aborted(signal);
            siblingAborted.resolve();
          },
          () => Promise.reject(new Error('broken')),
        ]),
      ]),
    ).rejects.toThrow('broken');
    await siblingAborted.promise;
    expect(siblingSignal?.aborted).toBe(true);
  });

  it('cancels the flow when a hook cancels', async () => {
    const after = vi.fn();
    const result = await runFlow([
      () => ({ a: 1 }),
      every([
        (ctx) => ({ ...ctx, b: 2 }),
        () => Promise.reject(new CancelError()),
      ]),
      after,
    ]);
    expect(result).toEqual({ context: { a: 1 }, cancelled: true });
    expect(after).not.toHaveBeenCalled();
  });

  it('validates its arguments eagerly', () => {
    // @ts-expect-error -- invalid input on purpose
    expect(() => every([null])).toThrow('got object at index 0');
  });
});
