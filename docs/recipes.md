# Recipes

flow-hooks keeps its API small on purpose. Retries, timeouts, logging and branching aren't built in, because each one is a few lines of plain JavaScript: **a function that takes a hook and returns a new hook**. Copy the ones you need into your project and change them as you like.

All helpers here are complete. For full programs that use them, see [Examples](examples.md).

**Building flows:** [Reuse steps](#reuse-a-group-of-steps) · [Configurable steps](#configurable-steps) · [If, else and switch](#if-else-and-switch) · [Run a flow for each item](#run-a-flow-for-each-item)<br>
**Reliability:** [Retry](#retry-a-flaky-step) · [Timeout a step](#time-out-one-step) · [Timeout a flow](#time-out-the-whole-flow) · [Optional steps](#optional-steps) · [Fallbacks](#fall-back-to-another-source)<br>
**Stopping early:** [Validation](#validate-input) · [Cache hits](#return-a-cached-result) · [Duplicates](#skip-duplicate-events)<br>
**Debugging:** [Log and time steps](#log-and-time-each-step) · [Record history](#record-every-context)<br>
**Integrations:** [Request handlers](#http-request-handlers) · [Express](#express) · [React](#react) · [Workers](#graceful-shutdown-in-workers) · [Testing](#testing)

## Building flows

### Reuse a group of steps

A flow is an array, so share steps by spreading them in:

```js
const authenticate = [readSession, loadUser];

await flow([...authenticate, listProjects], { req });
await flow([...authenticate, requireAdmin, deleteProject], { req });
```

To pass a group around as **one** hook instead, wrap it in `when()` with a condition that's always true. A `cancel()` inside still stops the whole flow:

```js
const sequence = (hooks) => when(() => true, hooks);

const authenticate = sequence([readSession, loadUser]);
```

### Configurable steps

When the same kind of step shows up with different settings, write a function that **returns** a hook (a hook factory):

```js
const requireFields =
  (...fields) =>
  (ctx) => {
    const missing = fields.filter((field) => ctx.input[field] == null);
    if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
  };

const setDefault = (key, value) => (ctx) =>
  ctx[key] === undefined ? { ...ctx, [key]: value } : undefined;

await flow(
  [
    requireFields('email', 'password'),
    setDefault('role', 'member'),
    createAccount,
  ],
  { input: { email: 'ada@example.com', password: 'secret123' } },
);
```

### If, else and switch

`when()` covers a plain _if_. For _if/else_, don't write two `when()`s with opposite conditions: the second condition sees the context **after** the first branch ran, which is rarely what you want. Pick the branch once instead:

```js
const ifElse = (condition, ifTrue, ifFalse) => async (ctx, api) =>
  (await condition(ctx, api)) ? ifTrue(ctx, api) : ifFalse(ctx, api);

ifElse((ctx) => ctx.user.isPremium, freeShipping, quoteShipping);
```

For more than two branches, look the hook up by key:

```js
const match = (select, cases) => (ctx, api) => {
  const hook = cases[select(ctx)] ?? cases.default;
  if (!hook) throw new Error(`No case for "${select(ctx)}"`);
  return hook(ctx, api);
};

match((ctx) => ctx.payment.method, {
  card: chargeCard,
  paypal: chargePaypal,
  invoice: sendInvoice,
  default: cancel(new Error('Unsupported payment method')),
});
```

To run several hooks in one branch, wrap them with `sequence()` from [above](#reuse-a-group-of-steps).

### Run a flow for each item

To process a list, run a smaller flow per item inside a hook. Pass `signal` down so the inner flows stop when the outer one is aborted:

```js
const priceLine = [
  (ctx) => ({ ...ctx, price: ctx.item.unitPrice * ctx.item.qty }),
  when(
    (ctx) => ctx.item.qty >= 10,
    (ctx) => ({ ...ctx, price: ctx.price * 0.9 }),
  ),
];

const priceAllLines = async (ctx, { signal }) => {
  const lines = await Promise.all(
    ctx.items.map((item) => flow(priceLine, { item }, { signal })),
  );
  return {
    ...ctx,
    lines,
    total: lines.reduce((sum, line) => sum + line.price, 0),
  };
};
```

Use a plain `for` loop instead of `Promise.all` to process the items one at a time. Each inner flow is independent: a `cancel()` inside one only stops that item.

## Reliability

### Retry a flaky step

```js
import { isCancelError } from 'flow-hooks';

const retry =
  (hook, { attempts = 3, delay = 0 } = {}) =>
  async (ctx, api) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await hook(ctx, api);
      } catch (error) {
        // Never retry a cancel, an aborted flow, or the last attempt.
        if (isCancelError(error) || api.signal.aborted || attempt >= attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  };

await flow([
  retry(fetchExchangeRates, { attempts: 5, delay: 200 }),
  convertPrices,
]);
```

Retrying is safe because the context is immutable: a failed attempt can't leave half-written data behind.

### Time out one step

Give a single hook its own deadline by handing it a signal that aborts on either the flow's signal **or** a timer:

```js
const withTimeout = (ms, hook) => (ctx, api) =>
  hook(ctx, {
    ...api,
    signal: AbortSignal.any([api.signal, AbortSignal.timeout(ms)]),
  });

await flow([withTimeout(2_000, fetchRecommendations), render]);
```

?> A timeout can only interrupt work that listens to the signal. `fetch(url, { signal })` does. For your own code, pass `signal` down or check `signal.aborted`.

### Time out the whole flow

Pass a signal to `flow()`. Keep a reference to it so you can tell a timeout apart from other errors:

```js
const deadline = AbortSignal.timeout(5_000);

try {
  await flow(hooks, ctx, { signal: deadline });
} catch (error) {
  if (deadline.aborted) return respond(504, 'Timed out');
  throw error;
}
```

Checking `deadline.aborted` is more reliable than checking `error.name`, because the error is whatever the interrupted hook threw (`fetch` throws the signal's `TimeoutError`, Node's timers throw an `AbortError`).

### Optional steps

For nice-to-have work, let the flow continue if a step fails:

```js
import { isCancelError } from 'flow-hooks';

const optional = (hook) => async (ctx, api) => {
  try {
    return await hook(ctx, api);
  } catch (error) {
    if (isCancelError(error) || api.signal.aborted) throw error;
    console.warn('Optional step failed:', error);
    return undefined; // keep the context as it was
  }
};

await flow([
  loadArticle,
  optional(withTimeout(300, loadRelatedArticles)), // a slow sidebar shouldn't block the page
  render,
]);
```

To use a default value instead, return `{ ...ctx, related: [] }` in place of `undefined`.

### Fall back to another source

`any()` starts all hooks at once and continues with the first that succeeds. The others are aborted:

```js
const fetchJson =
  (url) =>
  async (ctx, { signal }) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return { ...ctx, data: await response.json() };
  };

await flow([
  any([
    fetchJson('https://eu.api.example.com/rates'),
    fetchJson('https://us.api.example.com/rates'),
  ]),
]);
```

If you'd rather try them **one after another** (only call the backup if the primary fails), write a small helper:

```js
const firstThatWorks = (hooks) => async (ctx, api) => {
  const errors = [];
  for (const hook of hooks) {
    try {
      return await hook(ctx, api);
    } catch (error) {
      if (isCancelError(error) || api.signal.aborted) throw error;
      errors.push(error);
    }
  }
  throw new AggregateError(errors, 'Every fallback failed');
};
```

## Stopping early

### Validate input

`cancel(error)` fails the flow with your error. `cancel()` stops it quietly:

```js
class ValidationError extends Error {}

await flow(
  [
    when((ctx) => !ctx.email, cancel(new ValidationError('Email is required'))),
    when((ctx) => ctx.unsubscribed, cancel()), // nothing to send, but not an error
    sendNewsletter,
  ],
  subscriber,
);
```

### Return a cached result

```js
const cache = new Map();

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
  { key: 'report-2026-10' },
);

console.log(cancelled ? 'from cache' : 'computed', context.value);
```

### Skip duplicate events

Throwing `CancelError` from any hook works the same as `cancel()`, which is handy inside a hook that already has an `if`:

```js
import { CancelError } from 'flow-hooks';

const skipIfProcessed = async (ctx) => {
  if (await db.events.exists(ctx.event.id)) throw new CancelError('Duplicate');
};
```

## Debugging

### Log and time each step

```js
const traced = (name, hook) => async (ctx, api) => {
  const start = performance.now();
  try {
    return await hook(ctx, api); // always return the result
  } finally {
    console.log(`${name}: ${(performance.now() - start).toFixed(1)}ms`);
  }
};

await flow([traced('load user', loadUser), traced('render', render)]);
```

To trace every step, map over the array. Function names make good labels:

```js
await flow(
  hooks.map((hook) => traced(hook.name || 'anonymous', hook)),
  ctx,
);
```

### Record every context

Each step produces a new frozen object, so a full history is cheap and can't be changed afterwards:

```js
const history = [];
const record = (hook) => async (ctx, api) => {
  const next = await hook(ctx, api);
  history.push(next ?? ctx);
  return next;
};

await flow(hooks.map(record), initial);
console.table(history);
```

## Integrations

### HTTP request handlers

With the standard `Request` / `Response` classes (Hono, Bun, Deno, Next.js route handlers, Cloudflare Workers), a handler is a flow that ends with a `response` in the context. Throw an error with a status to stop early:

```js
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const handler = (hooks) => async (request) => {
  try {
    const { context } = await runFlow(
      hooks,
      { request },
      { signal: request.signal },
    );
    return context.response ?? new Response(null, { status: 204 });
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return Response.json({ error: error.message }, { status: error.status });
  }
};

export const POST = handler([
  authenticate,
  requireRole('editor'),
  parseJson,
  createProject,
]);
```

The full version, with each step written out, is [example 05](https://github.com/radenkovic/flow-hooks/blob/master/examples/05-http-handler.ts).

### Express

```js
app.post('/orders', async (req, res, next) => {
  try {
    const { context, cancelled } = await runFlow(
      [validateOrder, every([priceItems, checkAddress]), createOrder],
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

### React

Abort the flow when the component unmounts or its input changes, so a slow, stale request never overwrites a newer one:

```jsx
function SearchResults({ query }) {
  const [results, setResults] = useState([]);

  useEffect(() => {
    const controller = new AbortController();
    flow([fetchResults, rankResults], { query }, { signal: controller.signal })
      .then((ctx) => setResults(ctx.results))
      .catch((error) => {
        if (!controller.signal.aborted) throw error;
      });
    return () => controller.abort();
  }, [query]);

  return <List items={results} />;
}
```

### Graceful shutdown in workers

Pass one shared signal to every flow, and abort it when the process is asked to stop. Work in progress is interrupted through `api.signal`, and the job can be retried later:

```js
const shutdown = new AbortController();
process.on('SIGTERM', () => shutdown.abort());

for await (const job of queue) {
  try {
    await flow(handleJob, { job }, { signal: shutdown.signal });
    await job.ack();
  } catch (error) {
    if (shutdown.signal.aborted) break; // not acked, so the queue redelivers it
    await job.fail(error);
  }
}
```

See [example 06](https://github.com/radenkovic/flow-hooks/blob/master/examples/06-webhook-worker.ts) for a runnable version.

### Testing

A hook is a plain function, so test it by calling it with a plain object. The second argument only needs a `signal`:

```js
import { expect, test } from 'vitest';
import { flow } from 'flow-hooks';

const api = { signal: new AbortController().signal };

test('addTotal sums the items', () => {
  expect(addTotal({ items: [{ price: 20, qty: 2 }] }, api)).toEqual({
    items: [{ price: 20, qty: 2 }],
    total: 40,
  });
});

test('orders over $50 ship free', async () => {
  const order = await flow([addTotal, freeShipping], {
    items: [{ price: 30, qty: 2 }],
  });
  expect(order.freeShipping).toBe(true);
});
```

Test the parts that matter on their own, and the whole flow for the paths through it (finished, cancelled, failed). See [example 07](https://github.com/radenkovic/flow-hooks/blob/master/examples/07-testing.ts).
