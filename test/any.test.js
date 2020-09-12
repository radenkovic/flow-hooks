const flow = require('../lib/flow');
const any = require('../lib/any');
const cancel = require('../lib/cancel');
const wait = require('../lib/wait');

it('Runs any item', async () => {
  const hookA = jest.fn();
  const hookB = jest.fn();
  const wrapper = async () => {
    await wait(30);
    return hookB;
  };
  const hookC = jest.fn();
  await flow([hookA, any([wrapper, hookC])]);
  expect(hookA).toHaveBeenCalledTimes(1);
  expect(hookB).toHaveBeenCalledTimes(0);
  expect(hookC).toHaveBeenCalledTimes(1);
});

it('Returns proper context', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = true;
    },
    any([
      async (ctx) => {
        await wait(10);
        ctx.b = true;
      },
      (ctx) => {
        ctx.c = true;
      },
    ]),
  ]);
  expect(result).toHaveProperty('a');
  expect(result).not.toHaveProperty('b');
  expect(result).toHaveProperty('c');
});

it('Runs after any', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = true;
    },
    any([
      async (ctx) => {
        await wait(10);
        ctx.b = true;
      },
      (ctx) => {
        ctx.c = true;
      },
    ]),
    (ctx) => {
      ctx.d = true;
    },
  ]);
  expect(result).toHaveProperty('a');
  expect(result).not.toHaveProperty('b');
  expect(result).toHaveProperty('c');
  expect(result).toHaveProperty('d');
});

it('Cancel in any()', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = true;
    },
    any([
      async (ctx) => {
        await wait(10); // this should not run too
        ctx.b = true;
      },
      cancel(),
      // Everything below should not run
      (ctx) => {
        ctx.c = true;
      },
    ]),
    (ctx) => {
      ctx.d = true;
    },
  ]);
  expect(result).toHaveProperty('a');
  expect(result).not.toHaveProperty('b');
  expect(result).not.toHaveProperty('c');
  expect(result).not.toHaveProperty('d');
});

it('Error in any()', async () => {
  try {
    const result = await flow([
      (ctx) => {
        ctx.a = true;
      },
      any([
        () => {
          throw new Error('broken');
        },
        // Everything below should not run
        (ctx) => {
          ctx.c = true;
        },
      ]),
      (ctx) => {
        ctx.d = true;
      },
    ]);
    expect(result).toBeUndefined();
  } catch (e) {
    expect(e).toBeDefined();
    expect(e.message).toBe('broken');
  }
});
