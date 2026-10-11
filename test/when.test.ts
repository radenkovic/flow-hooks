import { describe, expect, it, vi } from 'vitest';
import { cancel, flow, runFlow, when } from '../src';

describe('when()', () => {
  it('runs a hook sequence when the condition is truthy', async () => {
    const result = await flow([
      () => ({ a: 'ok' }),
      when(
        () => true,
        [(ctx) => ({ ...ctx, b: 'ok' }), (ctx) => ({ ...ctx, c: ctx.b + '!' })],
      ),
      (ctx) => ({ ...ctx, d: 'ok' }),
    ]);
    expect(result).toEqual({ a: 'ok', b: 'ok', c: 'ok!', d: 'ok' });
  });

  it('runs a single hook when the condition is truthy', async () => {
    const result = await flow([
      when(
        () => 1,
        () => ({ ran: true }),
      ),
    ]);
    expect(result).toEqual({ ran: true });
  });

  it('supports an async condition', async () => {
    const result = await flow([
      when(
        () => Promise.resolve(true),
        () => ({ ran: true }),
      ),
    ]);
    expect(result).toEqual({ ran: true });
  });

  it.each([false, 0, '', null, undefined])(
    'skips the hooks when the condition returns %o',
    async (value) => {
      const hook = vi.fn();
      const result = await flow([
        () => ({ a: 1 }),
        when(() => value, [hook, cancel()]),
        (ctx) => ({ ...ctx, after: true }),
      ]);
      expect(hook).not.toHaveBeenCalled();
      expect(result).toEqual({ a: 1, after: true });
    },
  );

  it('keeps the context when a sequence returns nothing', async () => {
    const initial = await flow([() => ({ a: 1 })]);
    const result = await flow([when(() => true, [() => undefined])], initial);
    expect(result).toBe(initial);
  });

  it('passes the current context to the condition', async () => {
    const condition = vi.fn(() => false);
    await flow([() => ({ a: 'ok' }), when(condition, [])]);
    expect(condition).toHaveBeenCalledWith(
      { a: 'ok' },
      { signal: expect.any(AbortSignal) as unknown },
    );
  });

  it('validates return values inside a sequence', async () => {
    await expect(
      // @ts-expect-error -- invalid return value on purpose
      flow([when(() => true, [() => undefined, () => 5])]),
    ).rejects.toThrow('Hook at index 1 must return a new context object');
  });

  it('can be nested', async () => {
    const result = await flow([
      when(() => true, [when(() => true, [(ctx) => ({ ...ctx, deep: true })])]),
    ]);
    expect(result).toEqual({ deep: true });
  });

  it('cancels the whole flow from inside a sequence', async () => {
    const after = vi.fn();
    const result = await runFlow([
      () => ({ a: 1 }),
      when(() => true, [(ctx) => ({ ...ctx, b: 2 }), cancel(), after]),
      after,
    ]);
    expect(after).not.toHaveBeenCalled();
    expect(result).toEqual({ context: { a: 1, b: 2 }, cancelled: true });
  });

  it('propagates errors from the hooks', async () => {
    const after = vi.fn();
    await expect(
      flow([
        when(
          () => true,
          () => {
            throw new Error('inside when');
          },
        ),
        after,
      ]),
    ).rejects.toThrow('inside when');
    expect(after).not.toHaveBeenCalled();
  });

  it('propagates errors from the condition', async () => {
    await expect(
      flow([
        when(() => {
          throw new Error('bad condition');
        }, []),
      ]),
    ).rejects.toThrow('bad condition');
  });

  it('validates its arguments eagerly', () => {
    // @ts-expect-error -- invalid input on purpose
    expect(() => when(true, [])).toThrow('when() expects a condition function');
    // @ts-expect-error -- invalid input on purpose
    expect(() => when(() => true, 'x')).toThrow(
      'when() expects a hook or an array of hooks',
    );
    // @ts-expect-error -- invalid input on purpose
    expect(() => when(() => true, [1])).toThrow('got number at index 0');
  });
});
