# flow-hooks

[![npm version](https://img.shields.io/npm/v/flow-hooks)](https://www.npmjs.com/package/flow-hooks)
[![CI](https://img.shields.io/github/actions/workflow/status/radenkovic/flow-hooks/ci.yml?branch=master&label=CI)](https://github.com/radenkovic/flow-hooks/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/radenkovic/flow-hooks/master)](https://codecov.io/gh/radenkovic/flow-hooks)
[![types](https://img.shields.io/npm/types/flow-hooks)](https://www.npmjs.com/package/flow-hooks?activeTab=code)
[![bundle size](https://img.shields.io/bundlejs/size/flow-hooks)](https://bundlejs.com/?q=flow-hooks)
[![license](https://img.shields.io/npm/l/flow-hooks)](https://github.com/radenkovic/flow-hooks/blob/master/LICENSE)

> Composable async flows built from small, immutable steps: sequence, branch, race and run in parallel, with cancellation built in.

Write async logic as **a list of small steps** instead of one long function. Each step (a **hook**) receives a frozen **context** object and returns the next one, like a reducer.

```sh
npm install flow-hooks
```

## Example

```js
import { cancel, flow, when } from 'flow-hooks';

const checkout = [
  // Stop early, without an error, when there's nothing to do.
  when((ctx) => ctx.items.length === 0, cancel()),

  // Each step returns the next context.
  (ctx) => ({ ...ctx, total: ctx.items.reduce((sum, i) => sum + i.price, 0) }),

  // Only runs when the condition is true.
  when(
    (ctx) => ctx.coupon === 'SAVE10',
    (ctx) => ({ ...ctx, total: ctx.total * 0.9 }),
  ),

  // Return nothing for side effects. The context passes through unchanged.
  (ctx) => {
    console.log(`Charging $${ctx.total}`);
  },
];

const order = await flow(checkout, {
  items: [{ price: 60 }, { price: 40 }],
  coupon: 'SAVE10',
});
// Charging $90

order.total; // 90
```

## Why

Compare one long function:

```js
async function checkout(cart, user) {
  if (cart.items.length === 0) return;
  const total = sum(cart.items);
  const [stock, shipping] = await Promise.all([
    reserveStock(cart),
    quoteShipping(user),
  ]);
  let payment;
  try {
    payment = await chargeWithStripe(user, total);
  } catch {
    payment = await chargeWithPaypal(user, total);
  }
  await sendConfirmation(user, payment);
}
```

with the same process as a flow:

```js
const checkout = [
  when((ctx) => ctx.cart.items.length === 0, cancel()),
  addTotal,
  every([reserveStock, quoteShipping]), // in parallel
  any([chargeWithStripe, chargeWithPaypal]), // first one to succeed
  sendConfirmation,
];

await flow(checkout, { cart, user }, { signal: AbortSignal.timeout(10_000) });
```

- **You can read the process at a glance.** Each line is one step; the details live in small, named functions.
- **Each step is easy to test.** A hook is a plain function: call it with an object and check what it returns.
- **Steps can't interfere.** The context is frozen, so no step can change data another step, a parallel step or the caller is holding.
- **Cancellation reaches everything.** One `AbortSignal` goes to every hook. When `every()` fails or `any()` has a winner, the leftover work is aborted.

For a three-line function you don't need any of this. It pays off once a process has branches, parallel work, early exits and retries.

## API

| Function                                | What it does                                                    |
| --------------------------------------- | --------------------------------------------------------------- |
| `flow(hooks, context?, { signal? })`    | Runs hooks in order. Resolves with the final, frozen context.   |
| `runFlow(hooks, context?, { signal? })` | Same, but resolves with `{ context, cancelled }`.               |
| `when(condition, hook \| hooks[])`      | Runs the hook(s) only if `condition(ctx)` is truthy.            |
| `every(hooks[])`                        | Runs hooks in parallel, waits for all and merges their results. |
| `any(hooks[])`                          | Runs hooks in parallel and continues with the first to succeed. |
| `cancel()` / `cancel(error)`            | Stops the flow quietly, or fails it with `error`.               |

A hook is `(ctx, { signal }) => nextCtx`, sync or async. Return a new object to change the context, return nothing to keep it, and throw to fail the flow.

## Documentation

**[radenkovic.github.io/flow-hooks](https://radenkovic.github.io/flow-hooks/)**

- **[Getting started](https://radenkovic.github.io/flow-hooks/#/getting-started):** learn it in nine short steps.
- **[Examples](https://radenkovic.github.io/flow-hooks/#/examples):** complete, runnable programs: HTTP handler, webhook worker, parallel loading, retries, tests. They're in [`examples/`](./examples).
- **[Recipes](https://radenkovic.github.io/flow-hooks/#/recipes):** retries, timeouts, fallbacks, if/else, caching, logging, Express, React.
- **[Common mistakes](https://radenkovic.github.io/flow-hooks/#/mistakes):** the errors you're most likely to see, and the fixes.
- **[API reference](https://radenkovic.github.io/flow-hooks/#/api)** and **[TypeScript](https://radenkovic.github.io/flow-hooks/#/typescript)**.

Written in TypeScript with no runtime dependencies. Ships ESM and CommonJS, and runs in Node.js 22+ and modern browsers.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup; `npm run check` runs everything CI runs.

## License

[MIT](./LICENSE)
