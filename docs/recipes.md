# Recipes

Hooks are plain functions, so most extra behaviour is a few lines of code. Copy what you need.

## Hook factories

Turn repeated steps into functions that return hooks:

```ts
const requireFields =
  (...fields) =>
  (ctx) => {
    const missing = fields.filter((field) => ctx.input[field] == null);
    if (missing.length) {
      throw new ValidationError(`Missing: ${missing.join(', ')}`);
    }
  };

const setDefault = (key, value) => (ctx) =>
  ctx[key] === undefined ? { ...ctx, [key]: value } : undefined;

await flow(
  [
    requireFields('email', 'password'),
    setDefault('role', 'user'),
    createAccount,
  ],
  { input },
);
```

## Reusing groups of steps

A flow is an array, so you can spread shared steps into it:

```ts
const authenticate = [readSession, loadUser];

await flow([...authenticate, listProjects], { req });
await flow([...authenticate, requireAdmin, deleteProject], { req });
```

If you'd rather pass a group around as a single hook, wrap it with `when()`. A cancel inside still stops the whole flow:

```ts
const sequence = (hooks) => when(() => true, hooks);

const authenticate = sequence([readSession, loadUser]);
```

## Retry

```ts
import { isCancelError } from 'flow-hooks';

const retry =
  (hook, attempts = 3) =>
  async (ctx, api) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await hook(ctx, api);
      } catch (error) {
        // Never retry a cancel, an abort, or the last attempt.
        if (isCancelError(error) || api.signal.aborted || attempt >= attempts) {
          throw error;
        }
      }
    }
  };

await flow([retry(fetchExchangeRates, 5), convertPrices]);
```

Retrying is safe because the context is immutable: a failed attempt can't leave half-written data behind.

## Timeouts

Time out the whole flow with `AbortSignal.timeout()`. The flow rejects with a `TimeoutError`:

```ts
try {
  await flow(hooks, ctx, { signal: AbortSignal.timeout(5_000) });
} catch (error) {
  if (error.name === 'TimeoutError') return respond(504);
  throw error;
}
```

Or time out a single step by giving it its own signal:

```ts
const withTimeout = (ms, hook) => (ctx, api) =>
  hook(ctx, {
    ...api,
    signal: AbortSignal.any([api.signal, AbortSignal.timeout(ms)]),
  });

flow([withTimeout(2_000, fetchRecommendations), render]);
```

?> The timeout only interrupts work that listens to `signal` (like `fetch`). Pass `api.signal` down to anything abortable.

## Fallbacks and racing mirrors

`any()` continues with the first source that succeeds and aborts the others:

```ts
const fetchJson =
  (url) =>
  async (ctx, { signal }) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return { ...ctx, data: await response.json() };
  };

await flow([
  any([fetchJson(PRIMARY), fetchJson(MIRROR_EU), fetchJson(MIRROR_US)]),
]);
```

If all of them fail, the error is an `AggregateError`, and `error.errors` holds each failure.

## Loading data in parallel

Each `every()` hook returns the context with its own data added, and the results are merged:

```ts
const dashboard = await flow(
  [
    every([
      async (ctx, { signal }) => ({
        ...ctx,
        user: await api.user(ctx.userId, { signal }),
      }),
      async (ctx, { signal }) => ({
        ...ctx,
        orders: await api.orders(ctx.userId, { signal }),
      }),
      async (ctx, { signal }) => ({
        ...ctx,
        alerts: await api.alerts(ctx.userId, { signal }),
      }),
    ]),
    buildViewModel,
  ],
  { userId },
);
```

If one request fails, the others are aborted.

## Early exit (cache hit)

```ts
const { context, cancelled } = await runFlow(
  [
    when(
      (ctx) => cache.has(ctx.key),
      [(ctx) => ({ ...ctx, value: cache.get(ctx.key) }), cancel()],
    ),
    computeExpensiveValue,
    (ctx) => {
      cache.set(ctx.key, ctx.value);
    },
  ],
  { key },
);

console.log(cancelled ? 'cache hit' : 'computed', context.value);
```

## Validation

Use `cancel(error)` to fail with a specific error, and `cancel()` to stop quietly:

```ts
class ValidationError extends Error {}

await flow([
  when((ctx) => !ctx.email, cancel(new ValidationError('Email is required'))),
  when((ctx) => ctx.unsubscribed, cancel()), // nothing to send, not an error
  sendNewsletter,
]);
```

## HTTP handlers

flow-hooks works as a small pipeline inside any framework. With Express:

```ts
app.post('/orders', async (req, res, next) => {
  try {
    const { context, cancelled } = await runFlow(
      [
        parseBody,
        requireFields('items', 'address'),
        every([priceItems, validateAddress]),
        when((ctx) => ctx.total === 0, cancel()),
        createOrder,
      ],
      { body: req.body, user: req.user },
      { signal: AbortSignal.timeout(10_000) },
    );

    if (cancelled) return res.status(204).end();
    res.status(201).json(context.order);
  } catch (error) {
    next(error);
  }
});
```

`req.body` is copied into the context, so the flow can't change the request.

## Logging and timing

Wrap a hook to add behaviour around it:

```ts
const traced = (name, hook) => async (ctx, api) => {
  const start = performance.now();
  try {
    return await hook(ctx, api);
  } finally {
    console.log(`${name}: ${(performance.now() - start).toFixed(1)}ms`);
  }
};

await flow([traced('load', loadUser), traced('render', render)]);
```

!> Always `return` the wrapped hook's result, or the context it produced is lost.

Because each step returns a new frozen object, recording a history of the context is a one-liner:

```ts
const history = [];
const record = (hook) => async (ctx, api) => {
  const next = await hook(ctx, api);
  history.push(next ?? ctx);
  return next;
};

await flow(hooks.map(record), initial);
```

## Cancelling from the UI

```ts
let controller;

async function search(query) {
  controller?.abort(); // stop the previous search
  controller = new AbortController();

  try {
    const { results } = await flow(
      [fetchResults, rankResults],
      { query },
      { signal: controller.signal },
    );
    showResults(results);
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  }
}
```
