const flow = require('../lib/flow');
const cancel = require('../lib/cancel');

it('Cancel flow', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    cancel(),
    (ctx) => {
      ctx.b = 'ok';
    },
  ]);

  expect(result).toHaveProperty('a', 'ok');
  expect(result).not.toHaveProperty('b', 'ok');
});

it('Cancel flow with error', async () => {
  try {
    const result = await flow([
      (ctx) => {
        ctx.a = 'ok';
      },
      cancel(new Error('flow cancelled')),
      (ctx) => {
        ctx.b = 'ok';
      },
    ]);
    expect(result).toBeUndefined();
  } catch (e) {
    expect(e).toBeDefined();
    expect(e.message).toBe('flow cancelled');
  }
});
