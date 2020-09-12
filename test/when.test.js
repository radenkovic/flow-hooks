const flow = require('../lib/flow');
const when = require('../lib/when');
const cancel = require('../lib/cancel');
it('When works', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    when(() => true, [
      (ctx) => {
        ctx.b = 'ok';
      },
    ]),
    (ctx) => {
      ctx.c = 'ok';
    },
  ]);

  expect(result).toHaveProperty('a', 'ok');
  expect(result).toHaveProperty('b', 'ok');
});

it('When works as last hook', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    when(() => true, [
      (ctx) => {
        ctx.b = 'ok';
      },
    ]),
  ]);

  expect(result).toHaveProperty('a', 'ok');
  // TODO: fix scenario
  // expect(result).toHaveProperty('b', 'ok');
});

it('When() skips on falsy condition', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    when(() => false, [
      (ctx) => {
        ctx.b = 'ok';
      },
    ]),
    (ctx) => {
      ctx.c = 'ok';
    },
  ]);

  expect(result).toHaveProperty('a', 'ok');
  expect(result).not.toHaveProperty('b', 'ok');
  expect(result).toHaveProperty('c', 'ok');
});

it('When() receives context', async () => {
  const mock = jest.fn();
  await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    when(mock, [
      (ctx) => {
        ctx.b = 'ok';
      },
    ]),
    (ctx) => {
      ctx.c = 'ok';
    },
  ]);
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock).toHaveBeenCalledWith({ a: 'ok' });
});

it('Stop flow on exception in when()', async () => {
  try {
    const result = await flow([
      (ctx) => {
        ctx.c = 'c';
      },
      when(
        () => true,
        () => {
          throw new Error('stop when on exception');
        }
      ),
      (ctx) => {
        ctx.b = 'ok';
      },
    ]);
    expect(result).toBeUndefined();
  } catch (e) {
    expect(e).toBeDefined();
    expect(e.message).toBe('stop when on exception');
  }
});

it('When() skips on falsy condition', async () => {
  const result = await flow([
    (ctx) => {
      ctx.a = 'ok';
    },
    when(() => false, [
      (ctx) => {
        ctx.b = 'ok';
      },
      cancel(),
      (ctx) => {
        ctx.skip = 'ok';
      },
    ]),
    (ctx) => {
      ctx.c = 'ok';
    },
  ]);

  expect(result).toHaveProperty('a', 'ok');
  expect(result).not.toHaveProperty('b', 'ok');
  expect(result).toHaveProperty('c', 'ok');
  expect(result).not.toHaveProperty('skip', 'ok');
});
