import { describe, expect, it, vi } from 'vitest';
import { CancelError, any, flow, runFlow, type Hook } from '../src';
import { aborted, deferred } from './helpers';

describe('any()', () => {
  it('continues with the context returned by the first hook to succeed', async () => {
    const slow = deferred();
    const result = await flow([
      () => ({ a: true }),
      any([
        async (ctx) => {
          await slow.promise;
          return { ...ctx, slow: true };
        },
        (ctx) => ({ ...ctx, fast: true }),
      ]),
      (ctx) => ({ ...ctx, after: true }),
    ]);
    slow.resolve();
    expect(result).toEqual({ a: true, fast: true, after: true });
  });

  it('keeps the context when the winner returns undefined', async () => {
    const initial = await flow([() => ({ a: 1 })]);
    const never = deferred();
    const result = await flow(
      [any([() => never.promise.then(() => ({ b: 2 })), () => undefined])],
      initial,
    );
    expect(result).toBe(initial);
  });

  it('starts every hook before any of them settles', async () => {
    const calls: string[] = [];
    const gate = deferred();
    const promise = flow([
      any([
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

  it('aborts the hooks that lost the race', async () => {
    let loserSignal: AbortSignal | undefined;
    await flow([
      any([
        async (_ctx, { signal }) => {
          loserSignal = signal;
          await aborted(signal);
        },
        () => undefined,
      ]),
    ]);
    expect(loserSignal?.aborted).toBe(true);
  });

  it('ignores failures while another hook can still succeed', async () => {
    const result = await flow([
      any([
        () => {
          throw new Error('sync failure');
        },
        () => Promise.reject(new Error('async failure')),
        (() => 'not a context') as unknown as Hook,
        async (ctx) => {
          await Promise.resolve();
          return { ...ctx, ok: true };
        },
      ]),
    ]);
    expect(result).toEqual({ ok: true });
  });

  it('rejects with an AggregateError when every hook fails', async () => {
    const first = new Error('first');
    const promise = flow([
      any([
        () => {
          throw first;
        },
        (() => 42) as unknown as Hook,
      ]),
    ]);
    await expect(promise).rejects.toBeInstanceOf(AggregateError);
    await expect(promise).rejects.toMatchObject({
      errors: [
        first,
        expect.objectContaining({
          message: expect.stringContaining(
            'any() hook at index 1 must return a new context object',
          ) as unknown,
        }),
      ],
    });
  });

  it.each([
    [
      'sync',
      () => {
        throw new CancelError();
      },
    ],
    ['async', () => Promise.reject(new CancelError())],
  ])(
    'cancels the flow when a hook cancels (%s) before any succeeds',
    async (_, cancelling) => {
      const never = deferred();
      const after = vi.fn();
      const result = await runFlow([
        () => ({ a: 1 }),
        any([() => never.promise.then(() => undefined), cancelling]),
        after,
      ]);
      expect(result).toEqual({ context: { a: 1 }, cancelled: true });
      expect(after).not.toHaveBeenCalled();
    },
  );

  it('ignores a cancel that happens after a hook succeeded', async () => {
    const late = deferred();
    const result = await runFlow([
      any([
        async () => {
          await late.promise;
          throw new CancelError();
        },
        () => undefined,
      ]),
    ]);
    late.resolve();
    expect(result.cancelled).toBe(false);
  });

  it('aborts its hooks when the flow is aborted', async () => {
    const controller = new AbortController();
    const started = deferred();
    const promise = flow(
      [
        any([
          async (_ctx, { signal }) => {
            started.resolve();
            await aborted(signal);
            throw signal.reason;
          },
        ]),
      ],
      {},
      { signal: controller.signal },
    );
    await started.promise;
    controller.abort(new Error('user abort'));
    await expect(promise).rejects.toBeInstanceOf(AggregateError);
  });

  it('validates its arguments eagerly', () => {
    expect(() => any([])).toThrow('any() expects at least one hook');
    // @ts-expect-error -- invalid input on purpose
    expect(() => any('x')).toThrow('any() expects an array of hooks');
  });
});
