const flow = require('../lib/flow');
const every = require('../lib/every');
const cancel = require('../lib/cancel');

it('Runs every item', async () => {
  const hookA = jest.fn();
  const hookB = jest.fn();
  const hookC = jest.fn();

  await flow([hookA, every([hookB, hookC])]);

  expect(hookA).toHaveBeenCalledTimes(1);
  expect(hookB).toHaveBeenCalledTimes(1);
  expect(hookC).toHaveBeenCalledTimes(1);
});

it('Returns proper context', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = true;
    },
    every([
      (ctx) => {
        ctx.b = true;
      },
      (ctx) => {
        ctx.c = true;
      },
    ]),
  ]);
  expect(result).toHaveProperty('a');
  expect(result).toHaveProperty('b');
  expect(result).toHaveProperty('c');
});

it('Runs after every', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = true;
    },
    every([
      (ctx) => {
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
  expect(result).toHaveProperty('b');
  expect(result).toHaveProperty('c');
  expect(result).toHaveProperty('d');
});

it('Cancel in every()', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = true;
    },
    every([
      (ctx) => {
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
  expect(result).toHaveProperty('b');
  expect(result).not.toHaveProperty('c');
  expect(result).not.toHaveProperty('d');
});

it('Cancel in every()', async () => {
  try {
    const result = await flow([
      (ctx) => {
        ctx.a = true;
      },
      every([
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
