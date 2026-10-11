# Getting started

This page builds up flow-hooks one idea at a time. The snippets in steps 1 to 8 are complete programs: paste one into a `.mjs` file and run it with `node`. The output is shown in the comments.

```bash
npm install flow-hooks
```

## 1. A flow is a list of steps

A **hook** is a function that receives the **context** (a plain object) and returns the next context. `flow()` runs hooks in order, passing each one what the previous one returned.

```js
import { flow } from 'flow-hooks';

const result = await flow(
  [
    (ctx) => ({ ...ctx, price: 100 }),
    (ctx) => ({ ...ctx, tax: ctx.price * 0.2 }),
    (ctx) => ({ ...ctx, total: ctx.price + ctx.tax }),
  ],
  { product: 'Desk lamp' }, // the initial context
);

console.log(result);
// { product: 'Desk lamp', price: 100, tax: 20, total: 120 }
```

That's the whole model. Everything else on this page is a hook too, or a function that makes one.

## 2. Don't change the context, return a new one

The context is **frozen**. Changing it throws, so each hook spreads the old context and adds to it, like a reducer:

```js
(ctx) => {
  ctx.total = 120; // ✗ TypeError: Cannot add property total, object is not extensible
};

(ctx) => ({ ...ctx, total: 120 }); // ✓
```

This is what makes flows safe to reason about: a hook can never change data that another hook, a parallel hook or the caller is still looking at.

## 3. Side effects: return nothing

A hook that only _does_ something (logs, sends an email, writes to a database) returns nothing. The context passes through unchanged.

```js
import { flow } from 'flow-hooks';

await flow(
  [
    (ctx) => ({ ...ctx, total: 120 }),
    (ctx) => {
      console.log(`Charging $${ctx.total}`);
    },
    async (ctx) => {
      await saveToDatabase(ctx); // returns nothing either
    },
  ],
  {},
);
// Charging $120

async function saveToDatabase(order) {}
```

## 4. Conditional steps: `when()`

`when(condition, hook)` runs the hook only if the condition is true. Pass an array to run several hooks.

```js
import { flow, when } from 'flow-hooks';

const applyCoupon = (ctx) => ({ ...ctx, total: ctx.total * 0.9 });

const result = await flow(
  [
    (ctx) => ({ ...ctx, total: 100 }),
    when((ctx) => ctx.coupon === 'SAVE10', applyCoupon),
  ],
  { coupon: 'SAVE10' },
);

console.log(result.total); // 90
```

## 5. Stopping early: `cancel()`

Sometimes there's nothing left to do: the cart is empty, the result is cached, the event was already processed. `cancel()` stops the flow **without** an error. `flow()` still resolves, with the context as it was at that point.

Use `runFlow()` instead of `flow()` when you need to know whether the flow finished or stopped early:

```js
import { cancel, runFlow, when } from 'flow-hooks';

const checkout = [
  when((ctx) => ctx.items.length === 0, cancel()),
  (ctx) => ({ ...ctx, charged: true }),
];

console.log(await runFlow(checkout, { items: [] }));
// { context: { items: [] }, cancelled: true }

console.log(await runFlow(checkout, { items: ['lamp'] }));
// { context: { items: [ 'lamp' ], charged: true }, cancelled: false }
```

?> Note the parentheses: `cancel()` **returns** a hook. Write `when(cond, cancel())`, not `when(cond, cancel)`.

## 6. Failing: throw, or `cancel(error)`

When something is actually wrong, throw. The flow stops and `flow()` rejects with your error. `cancel(error)` is a shortcut for a hook that throws it, which reads nicely inside `when()`:

```js
import { cancel, flow, when } from 'flow-hooks';

const signUp = [
  when((ctx) => !ctx.email.includes('@'), cancel(new Error('Invalid email'))),
  (ctx) => {
    if (ctx.password.length < 8) throw new Error('Password too short');
  },
  (ctx) => ({ ...ctx, userId: 'user_1' }),
];

try {
  await flow(signUp, { email: 'ada@example.com', password: 'short' });
} catch (error) {
  console.log(error.message); // Password too short
}
```

To sum up the three ways out of a flow:

| You want to…                  | Use                              | `flow()` then…       |
| ----------------------------- | -------------------------------- | -------------------- |
| stop, nothing left to do      | `cancel()`                       | resolves             |
| stop because something failed | `throw error` or `cancel(error)` | rejects with `error` |
| stop it from the outside      | an `AbortSignal` (step 8)        | rejects              |

## 7. Parallel steps: `every()` and `any()`

**`every()`** starts several hooks at once and waits for all of them. Each hook spreads `ctx` and adds its own key, and the results are merged:

```js
import { every, flow } from 'flow-hooks';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const page = await flow(
  [
    every([
      async (ctx) => {
        await wait(30);
        return { ...ctx, user: { name: 'Ada' } };
      },
      async (ctx) => {
        await wait(20);
        return { ...ctx, orders: [1, 2, 3] };
      },
    ]),
  ],
  { userId: 7 },
);

console.log(page);
// { userId: 7, user: { name: 'Ada' }, orders: [ 1, 2, 3 ] }   (after ~30ms, not 50)
```

**`any()`** starts several hooks at once and continues with the **first one that succeeds**. Use it for fallbacks and racing mirrors:

```js
import { any, flow } from 'flow-hooks';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const result = await flow([
  any([
    async (ctx) => {
      throw new Error('Primary is down'); // ignored, another one can still win
    },
    async (ctx) => {
      await wait(50);
      return { ...ctx, from: 'slow mirror' };
    },
    async (ctx) => {
      await wait(10);
      return { ...ctx, from: 'fast mirror' };
    },
  ]),
]);

console.log(result.from); // fast mirror
```

If every hook in `any()` fails, the flow rejects with an `AggregateError` listing each failure.

## 8. Timeouts and aborting: `signal`

Every hook receives a second argument, `{ signal }`. It's a standard [`AbortSignal`](https://developer.mozilla.org/docs/Web/API/AbortSignal): pass it to `fetch()` and anything else that can be cancelled.

Pass your own signal to `flow()` to abort the whole flow, for example after a timeout:

```js
import { flow } from 'flow-hooks';

const deadline = AbortSignal.timeout(2_000);

try {
  await flow(
    [
      async (ctx, { signal }) => {
        const response = await fetch('https://example.com/slow', { signal });
        return { ...ctx, data: await response.text() };
      },
    ],
    {},
    { signal: deadline },
  );
} catch (error) {
  if (deadline.aborted) console.log('Took longer than 2 seconds');
  else throw error;
}
```

The signal also tells hooks when their work is no longer needed: when `any()` has a winner, the other hooks' signals are aborted; when one `every()` hook fails, the others' signals are aborted.

## 9. Putting it together

Because a flow is just an array of functions, you can name your steps, keep them in separate files, test them on their own and reuse them across flows:

```js
import { cancel, every, flow, when } from 'flow-hooks';
import {
  chargeCard,
  quoteShipping,
  reserveStock,
  sendConfirmation,
  validateCart,
} from './checkout-steps.js'; // each one is a small hook like the ones above

const checkout = [
  validateCart,
  when((ctx) => ctx.items.length === 0, cancel()),
  every([reserveStock, quoteShipping]),
  chargeCard,
  sendConfirmation,
];

await flow(
  checkout,
  { items, address },
  { signal: AbortSignal.timeout(10_000) },
);
```

Reading the array tells you what the process does, in order. Each step is a small function you can open when you need the details.

## Next steps

- **[Examples](examples.md):** complete, runnable programs: an HTTP handler, a webhook worker, parallel loading, retries and tests.
- **[Recipes](recipes.md):** copy-paste solutions for retries, timeouts, caching, logging and framework integration.
- **[Core concepts](guide.md):** the exact rules for the context, return values, cancellation and merging.
- **[Common mistakes](mistakes.md):** the handful of things that trip people up.
- **[TypeScript](typescript.md):** typing your context.
