import { describe, expect, it, vi } from 'vitest';
import {
  CancelError,
  cancel,
  every,
  flow,
  isCancelError,
  runFlow,
  when,
} from '../src';

describe('cancel()', () => {
  it('stops the flow and resolves with the context so far', async () => {
    const after = vi.fn();
    const result = await flow([() => ({ a: 'ok' }), cancel(), after]);
    expect(result).toEqual({ a: 'ok' });
    expect(after).not.toHaveBeenCalled();
  });

  it('rejects with the given error instead of resolving', async () => {
    const after = vi.fn();
    await expect(
      flow([cancel(new Error('flow cancelled')), after]),
    ).rejects.toThrow('flow cancelled');
    expect(after).not.toHaveBeenCalled();
  });

  it('resolves with the initial context when cancelled first', async () => {
    await expect(flow([cancel()], { a: 1 })).resolves.toEqual({ a: 1 });
  });

  it('resolves with the context the cancelling hook received', async () => {
    const result = await runFlow([
      () => ({ a: 1 }),
      async () => {
        await Promise.resolve();
        throw new CancelError('done early');
      },
      (ctx) => ({ ...ctx, b: 2 }),
    ]);
    expect(result).toEqual({ context: { a: 1 }, cancelled: true });
  });

  it('can be reused across flows', async () => {
    const stop = cancel();
    await expect(flow([stop], { run: 1 })).resolves.toEqual({ run: 1 });
    await expect(flow([stop], { run: 2 })).resolves.toEqual({ run: 2 });
  });

  it('reports the right context when concurrent flows share an error instance', async () => {
    const error = new CancelError();
    const hook = async () => {
      await Promise.resolve();
      throw error;
    };
    const results = await Promise.all([
      flow([hook], { run: 1 }),
      flow([hook], { run: 2 }),
    ]);
    expect(results).toEqual([{ run: 1 }, { run: 2 }]);
  });
});

describe('composed hooks outside of a flow', () => {
  const api = { signal: new AbortController().signal };

  it('when() can be called directly', async () => {
    const hook = when(() => true, [cancel()]);
    await expect(hook({}, api)).rejects.toBeInstanceOf(CancelError);
  });

  it('every() can be called directly', async () => {
    const hook = every([() => ({ a: 1 })]);
    await expect(hook({}, api)).resolves.toEqual({ a: 1 });
  });
});

describe('CancelError', () => {
  it('is an Error with a default message', () => {
    const error = new CancelError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CancelError');
    expect(error.message).toBe('Flow cancelled');
  });

  it('accepts a custom message', () => {
    expect(new CancelError('stop').message).toBe('stop');
  });
});

describe('isCancelError()', () => {
  it('recognises CancelError', () => {
    expect(isCancelError(new CancelError())).toBe(true);
  });

  it.each([new Error('x'), null, undefined, 'CancelError', {}])(
    'rejects %o',
    (value) => {
      expect(isCancelError(value)).toBe(false);
    },
  );

  it('recognises errors from another copy of the package', () => {
    const foreign = Object.create({
      [Symbol.for('flow-hooks.cancel')]: true,
    }) as unknown;
    expect(isCancelError(foreign)).toBe(true);
  });
});
