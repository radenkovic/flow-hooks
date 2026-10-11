import { describe, expect, it, vi } from 'vitest';
import { cancel, flow, runFlow } from '../src';
import { aborted, deferred } from './helpers';

describe('flow()', () => {
  it('passes each hook the context the previous one returned', async () => {
    const result = await flow([
      () => ({ a: 1 }),
      async (ctx) => {
        await Promise.resolve();
        return { ...ctx, b: ctx.a + 1 };
      },
      (ctx) => ({ ...ctx, c: ctx.b + 1 }),
    ]);
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('runs hooks in order', async () => {
    const order: string[] = [];
    await flow([
      async () => {
        await Promise.resolve();
        order.push('a');
      },
      () => {
        order.push('b');
      },
    ]);
    expect(order).toEqual(['a', 'b']);
  });

  it('resolves with an empty frozen object for an empty flow', async () => {
    const result = await flow([]);
    expect(result).toEqual({});
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('keeps the context when a hook returns undefined', async () => {
    const seen: object[] = [];
    const result = await flow(
      [
        (ctx) => {
          seen.push(ctx);
        },
        async (ctx) => {
          await Promise.resolve();
          seen.push(ctx);
        },
      ],
      { a: 1 },
    );
    expect(seen[0]).toBe(seen[1]);
    expect(result).toBe(seen[0]);
  });

  it('lets a hook drop keys by leaving them out', async () => {
    const result = await flow(
      [
        (ctx) => {
          const { secret, ...rest } = ctx;
          return rest;
        },
      ],
      { secret: 'token', user: 'dan' },
    );
    expect(result).toEqual({ user: 'dan' });
  });

  it('starts from the initial context', async () => {
    const result = await flow([(ctx) => ({ ...ctx, b: true })], { a: true });
    expect(result).toEqual({ a: true, b: true });
  });

  it('passes the context and the hook API to each hook', async () => {
    const hook = vi.fn();
    await flow([hook], { a: 1 });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(
      { a: 1 },
      { signal: expect.any(AbortSignal) as unknown },
    );
  });

  describe('errors', () => {
    it('rejects with a synchronous error and stops the flow', async () => {
      const after = vi.fn();
      await expect(
        flow([
          () => {
            throw new Error('boom');
          },
          after,
        ]),
      ).rejects.toThrow('boom');
      expect(after).not.toHaveBeenCalled();
    });

    it('rejects with an asynchronous error and stops the flow', async () => {
      const after = vi.fn();
      await expect(
        flow([() => Promise.reject(new Error('async boom')), after]),
      ).rejects.toThrow('async boom');
      expect(after).not.toHaveBeenCalled();
    });

    it('rejects non-array input', async () => {
      // @ts-expect-error -- invalid input on purpose
      await expect(flow(() => undefined)).rejects.toThrow(
        'flow() expects an array of hooks',
      );
    });

    it('rejects non-function hooks with their index', async () => {
      // @ts-expect-error -- invalid input on purpose
      await expect(flow([() => undefined, 'nope'])).rejects.toThrow(
        'got string at index 1',
      );
    });
  });

  describe('abort signal', () => {
    it('rejects with the abort reason before running any hook', async () => {
      const hook = vi.fn();
      const reason = new Error('stopped');
      await expect(
        flow([hook], {}, { signal: AbortSignal.abort(reason) }),
      ).rejects.toBe(reason);
      expect(hook).not.toHaveBeenCalled();
    });

    it('stops between hooks once aborted', async () => {
      const controller = new AbortController();
      const after = vi.fn();
      const promise = flow(
        [
          () => {
            controller.abort();
          },
          after,
        ],
        {},
        { signal: controller.signal },
      );
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      expect(after).not.toHaveBeenCalled();
    });

    it('rejects when aborted during the last hook', async () => {
      const controller = new AbortController();
      const started = deferred();
      const promise = flow(
        [
          async (_ctx, { signal }) => {
            started.resolve();
            await aborted(signal);
          },
        ],
        {},
        { signal: controller.signal },
      );
      await started.promise;
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });
  });
});

describe('runFlow()', () => {
  it('reports a completed flow', async () => {
    const result = await runFlow([() => ({ a: 1 })]);
    expect(result).toEqual({ context: { a: 1 }, cancelled: false });
  });

  it('reports a cancelled flow', async () => {
    const result = await runFlow([() => ({ a: 1 }), cancel()]);
    expect(result).toEqual({ context: { a: 1 }, cancelled: true });
  });
});
