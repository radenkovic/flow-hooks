import { describe, expect, it } from 'vitest';
import { flow, runFlow, type Hook } from '../src';

// Test files are ES modules, so they run in strict mode and writes to frozen
// objects throw instead of failing silently.

describe('frozen context', () => {
  it('freezes the context passed to hooks', async () => {
    let seen: object | undefined;
    await flow(
      [
        (ctx) => {
          seen = ctx;
        },
      ],
      { a: 1 },
    );
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it('throws when a hook assigns to the context', async () => {
    await expect(
      flow([
        (ctx) => {
          // @ts-expect-error -- also rejected at compile time
          ctx.a = 1;
        },
      ]),
    ).rejects.toThrow(TypeError);
  });

  it('freezes nested plain objects and arrays', async () => {
    const result = await flow([], {
      user: { name: 'dan', tags: ['admin'] },
      list: [{ id: 1 }],
    });
    expect(Object.isFrozen(result.user)).toBe(true);
    expect(Object.isFrozen(result.user.tags)).toBe(true);
    expect(Object.isFrozen(result.list)).toBe(true);
    expect(Object.isFrozen(result.list[0])).toBe(true);
    await expect(
      flow([(ctx) => ctx.list.push('x')], { list: [] }),
    ).rejects.toThrow(TypeError);
  });

  it('freezes the objects hooks return, including new nested data', async () => {
    const result = await flow([() => ({ user: { name: 'dan' } })]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.user)).toBe(true);
  });

  it('accepts null-prototype objects', async () => {
    const value = Object.assign(Object.create(null) as object, { x: 1 });
    const result = await flow([() => value]);
    expect(result).toEqual({ x: 1 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('does not freeze class instances, functions or built-ins', async () => {
    class Client {
      calls = 0;
    }
    const client = new Client();
    const date = new Date(0);
    const map = new Map<string, number>();
    const fn = Object.assign(() => undefined, { prop: 1 });
    const result = await flow([], { client, date, map, fn });
    expect(result.client).toBe(client);
    expect(result.date).toBe(date);
    expect(result.map).toBe(map);
    expect(result.fn).toBe(fn);
    expect(Object.isFrozen(client)).toBe(false);
    expect(Object.isFrozen(fn)).toBe(false);
    client.calls += 1;
    map.set('a', 1);
    expect(client.calls).toBe(1);
  });

  it('does not evaluate getters while freezing', async () => {
    let reads = 0;
    const withGetter = {
      get value() {
        reads += 1;
        return { nested: true };
      },
    };
    await flow([() => withGetter]);
    expect(reads).toBe(0);
  });
});

describe('initial context', () => {
  it('never freezes or changes the object passed in', async () => {
    const initial = { a: 1, nested: { b: 2 }, list: [1] };
    const result = await flow([(ctx) => ({ ...ctx, a: 2 })], initial);
    expect(initial).toEqual({ a: 1, nested: { b: 2 }, list: [1] });
    expect(Object.isFrozen(initial)).toBe(false);
    expect(Object.isFrozen(initial.nested)).toBe(false);
    expect(Object.isFrozen(initial.list)).toBe(false);
    expect(result).toEqual({ a: 2, nested: { b: 2 }, list: [1] });
  });

  it('keeps shared and cyclic references in the copy', async () => {
    const shared = { n: 1 };
    const initial: Record<string, unknown> = { x: shared, y: shared };
    initial.self = initial;
    const result = await flow([], initial);
    expect(result.x).toBe(result.y);
    expect(result.self).toBe(result);
    expect(result.x).not.toBe(shared);
  });

  it('skips non-enumerable properties when copying', async () => {
    const initial = Object.defineProperty({ a: 1 }, 'hidden', {
      value: true,
      enumerable: false,
    });
    const result = await flow([], initial);
    expect(Object.keys(result)).toEqual(['a']);
    expect('hidden' in result).toBe(false);
  });

  it('reuses a context produced by another flow without copying', async () => {
    const first = await flow([() => ({ step: 1 })]);
    let seen: object | undefined;
    await flow(
      [
        (ctx) => {
          seen = ctx;
        },
      ],
      first,
    );
    expect(seen).toBe(first);
  });

  it.each([
    ['an array', [], 'an array'],
    ['a class instance', new Date(), 'an instance of Date'],
    ['null', null, 'null'],
    ['a string', 'ctx', 'string'],
  ])('rejects %s as the initial context', async (_, value, description) => {
    // @ts-expect-error -- invalid input on purpose
    await expect(flow([], value)).rejects.toThrow(
      `flow() expects the initial context to be a plain object, got ${description}`,
    );
  });
});

describe('hook return values', () => {
  const notAContext: [string, unknown, string][] = [
    ['a number', 1, 'number'],
    ['a string', 'text', 'string'],
    ['true', true, 'boolean'],
    ['null', null, 'null'],
    ['an array', [1, 2], 'an array'],
    ['a class instance', new Map(), 'an instance of Map'],
    ['a function', () => undefined, 'function'],
    [
      'an object without a constructor',
      Object.create(Object.create(null) as object) as unknown,
      'an instance of an unknown class',
    ],
  ];

  it.each(notAContext)(
    'rejects %s with the hook index',
    async (_, value, description) => {
      const hooks = [() => undefined, () => value] as Hook[];
      await expect(flow(hooks)).rejects.toThrow(
        `Hook at index 1 must return a new context object or undefined, got ${description}`,
      );
    },
  );

  it('fails the flow (rather than cancelling it) on an invalid return value', async () => {
    const result = runFlow([() => ({ a: 1 }), (() => 42) as unknown as Hook]);
    await expect(result).rejects.toThrow(TypeError);
  });
});
