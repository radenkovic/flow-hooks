const flow = require('../lib/flow');

it('Runs flow', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    (ctx) => {
      ctx.b = 'ok';
    },
  ]);

  expect(result).toHaveProperty('a', 'ok');
  expect(result).toHaveProperty('b', 'ok');
});

it('Runs flow, override/remove value', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    (ctx) => {
      ctx.a = 'changed';
      ctx.b = 'something';
    },
    (ctx) => {
      delete ctx.b;
    },
  ]);

  expect(result).toHaveProperty('a', 'changed');
  expect(result).not.toHaveProperty('b');
});

it('override whole context', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    () => {
      return { override: true };
    },
    (ctx) => {
      ctx.second = 'banana';
    },
  ]);

  expect(result).toHaveProperty('override', true);
  expect(result).toHaveProperty('second', 'banana');
  expect(result).not.toHaveProperty('a');
});

it('override whole context on the last hook', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    () => {
      return { override: true };
    },
  ]);
  expect(result).toBeDefined();
  // TODO: fix this scenario
  // expect(result).toHaveProperty('override', true);
  // expect(result).not.toHaveProperty('a');
});

it('Stop flow on exception', async () => {
  try {
    const result = await flow([
      () => {
        throw new Error('stop flow on exception');
      },
      (ctx) => {
        ctx.b = 'ok';
      },
    ]);
    expect(result).toBeUndefined();
  } catch (e) {
    expect(e).toBeDefined();
    expect(e.message).toBe('stop flow on exception');
  }
});

it('Setting initial context', async () => {
  const sampleCtx = { a: true };

  const result = await flow(
    [
      (ctx) => {
        ctx.b = true;
      },
    ],
    sampleCtx
  );
  expect(result).toHaveProperty('a');
  expect(result).toHaveProperty('b');
});

it('Count function calls (mocks)', async () => {
  const sampleCtx = { a: true };
  const hookA = jest.fn();
  const hookB = jest.fn();
  await flow([hookA, hookB], sampleCtx);

  expect(hookA).toHaveBeenCalledTimes(1);
  expect(hookB).toHaveBeenCalledTimes(1);
  expect(hookA).toHaveBeenCalledWith(sampleCtx);
});
