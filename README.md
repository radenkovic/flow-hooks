# flow-hooks

[![npm version](https://img.shields.io/npm/v/flow-hooks)](https://www.npmjs.com/package/flow-hooks)
[![CI](https://img.shields.io/github/actions/workflow/status/radenkovic/flow-hooks/ci.yml?branch=master&label=CI)](https://github.com/radenkovic/flow-hooks/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/radenkovic/flow-hooks/master)](https://codecov.io/gh/radenkovic/flow-hooks)
[![types](https://img.shields.io/npm/types/flow-hooks)](https://www.npmjs.com/package/flow-hooks?activeTab=code)
[![bundle size](https://img.shields.io/bundlejs/size/flow-hooks)](https://bundlejs.com/?q=flow-hooks)
[![license](https://img.shields.io/npm/l/flow-hooks)](https://github.com/radenkovic/flow-hooks/blob/master/LICENSE)

> Composable async flows built from small, immutable steps: sequence, branch, race and run in parallel, with cancellation built in.

Write async logic as a list of small steps instead of one long function. Each step (a **hook**) receives an immutable **context** and returns the next one, like a reducer. Steps can run conditionally or in parallel, and the flow can stop early, with or without an error.

**[Documentation](https://radenkovic.github.io/flow-hooks/)** · [Core concepts](https://radenkovic.github.io/flow-hooks/#/guide) · [API](https://radenkovic.github.io/flow-hooks/#/api) · [Recipes](https://radenkovic.github.io/flow-hooks/#/recipes)

## Features

- **Immutable by default:** every step gets a frozen context and returns a new one, so no step can change data behind another's back.
- **Small API:** `flow`, `when`, `any`, `every` and `cancel` cover most control flow.
- **Reusable steps:** hooks are plain functions, so you can share, wrap and test them on their own.
- **Parallel steps:** `any()` (first to succeed) and `every()` (all of them) start their hooks together.
- **Early exit:** cancel a flow without throwing, and still get the context back.
- **Abortable:** a single `AbortSignal` reaches every hook, which makes timeouts and user cancellation simple.
- **Typed:** written in TypeScript. The context is deeply readonly, so mutations are compile errors.
- **Lightweight:** no runtime dependencies. Ships ESM and CommonJS, and runs in Node.js 22+ and modern browsers.

## When to use it

flow-hooks fits anywhere a process is a series of async steps with branches and early exits:

- **Request handlers and API endpoints:** parse, authenticate, validate, load, respond.
- **Business workflows:** checkout, sign-up, onboarding, order fulfilment.
- **Data loading:** fetch from several sources in parallel, with fallbacks and timeouts.
- **Background jobs and webhooks:** skip duplicates, retry flaky calls, stop cleanly on shutdown.
- **CLI tools and scripts:** readable, testable pipelines instead of one long `main()`.

Because every step is a pure-ish function from context to context, each one can be unit-tested on its own with a plain object.

## Installation

```sh
npm install flow-hooks
```

```ts
import { flow, when, any, every, cancel } from 'flow-hooks'; // ESM / TypeScript
const { flow, when, any, every, cancel } = require('flow-hooks'); // CommonJS
```

## Example

```ts
import { any, cancel, every, flow, when } from 'flow-hooks';

const order = await flow(
  [
    // Return the next context.
    (ctx) => ({
      ...ctx,
      total: ctx.items.reduce((sum, item) => sum + item.price, 0),
    }),

    // Stop quietly when there's nothing to do; flow() still resolves.
    when((ctx) => ctx.items.length === 0, cancel()),

    // Run in parallel and wait for all of them. Their changes are merged.
    every([
      async (ctx, { signal }) => ({
        ...ctx,
        stock: await reserveStock(ctx.items, { signal }),
      }),
      async (ctx, { signal }) => ({
        ...ctx,
        shipping: await quoteShipping(ctx.address, { signal }),
      }),
    ]),

    // Run in parallel and continue with the first one that succeeds.
    any([chargeWithStripe, chargeWithPaypal]),

    // Fail the flow with a specific error.
    when((ctx) => !ctx.paymentId, cancel(new Error('Payment failed'))),

    // Side-effect only: return nothing to keep the context as it is.
    async (ctx) => {
      await sendConfirmation(ctx);
    },
  ],
  { items, address },
  { signal: AbortSignal.timeout(10_000) }, // abort the whole flow after 10s
);
```

## How it works

A hook is `(ctx, api) => nextCtx`, sync or async.

- **`ctx` is frozen.** Plain objects and arrays inside it are frozen too, so a mutation throws a `TypeError`.
- **Return a new context** (`{ ...ctx, key: value }`) to pass data to the next hook.
- **Return `undefined`** (nothing) to keep the context unchanged, for side-effect steps like logging or sending an email.
- Returning anything else (a number, an array, a class instance) is a bug, and the flow rejects with a `TypeError` that names the hook.
- **Throw** (or `cancel(error)`) to fail the flow. **`cancel()`** stops it without failing.
- **`api.signal`** is an `AbortSignal`. Pass it to `fetch()` and other abortable work.

The object you pass as the initial context is copied, never frozen or changed. Class instances (`Date`, `Map`, a request or a DB client) are kept by reference and not frozen. Read more in [Core concepts](https://radenkovic.github.io/flow-hooks/#/guide).

## API

| Function                                    | Description                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `flow(hooks, initialContext?, options?)`    | Run hooks in order. Resolves with the final (frozen) context.             |
| `runFlow(hooks, initialContext?, options?)` | Like `flow()`, but resolves with `{ context, cancelled }`.                |
| `when(condition, hook \| hooks[])`          | Run hooks only if `condition(ctx)` is truthy.                             |
| `any(hooks[])`                              | Start all hooks; continue with the first to succeed, abort the rest.      |
| `every(hooks[])`                            | Start all hooks; wait for all of them and merge the contexts they return. |
| `cancel(error?)`                            | Stop the flow. With an error, the flow rejects with it.                   |
| `CancelError`, `isCancelError(error)`       | Throw or detect a cancel from your own code.                              |

`options.signal` takes an `AbortSignal` to abort the flow. Full details are in the [API reference](https://radenkovic.github.io/flow-hooks/#/api).

## More examples

**Was the flow cancelled?**

```ts
const { context, cancelled } = await runFlow(
  [
    when(
      (ctx) => cache.has(ctx.key),
      [(ctx) => ({ ...ctx, value: cache.get(ctx.key) }), cancel()],
    ),
    computeValue,
    storeInCache,
  ],
  { key },
);
```

**Reusable steps**

```ts
const requireRole = (role) => (ctx) => {
  if (!ctx.user.roles.includes(role)) throw new ForbiddenError();
};

const authenticate = [readSession, loadUser];

await flow([...authenticate, requireRole('admin'), deleteProject], { req });
```

**Retry a flaky step**

```ts
const retry =
  (hook, attempts = 3) =>
  async (ctx, api) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await hook(ctx, api);
      } catch (error) {
        if (isCancelError(error) || api.signal.aborted || attempt >= attempts)
          throw error;
      }
    }
  };

await flow([retry(fetchRates), convertPrices]);
```

There's more in the [Recipes](https://radenkovic.github.io/flow-hooks/#/recipes): timeouts, fallbacks, HTTP handlers, logging and UI cancellation.

## TypeScript

Pass your context type, and every hook in the flow is checked against it. Hooks receive an `Immutable<C>`, so mutations are compile errors, and they must return a complete context:

```ts
import { flow, type Hook } from 'flow-hooks';

interface Order {
  id: string;
  total: number;
  paid?: boolean;
}

const charge: Hook<Order> = async (order, { signal }) => {
  await payments.charge(order.id, order.total, { signal });
  return { ...order, paid: true };
};

const order = await flow<Order>([validate, charge], { id: 'o_1', total: 42 });
//    ^? Immutable<Order>
```

See [TypeScript](https://radenkovic.github.io/flow-hooks/#/typescript) for more.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup; `npm run check` runs everything CI runs.

## License

[MIT](./LICENSE)
