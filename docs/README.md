# flow-hooks

> Composable async flows built from small, immutable steps: sequence, branch, race and run in parallel, with cancellation built in.

[![npm version](https://img.shields.io/npm/v/flow-hooks)](https://www.npmjs.com/package/flow-hooks)
[![CI](https://img.shields.io/github/actions/workflow/status/radenkovic/flow-hooks/ci.yml?branch=master&label=CI)](https://github.com/radenkovic/flow-hooks/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/radenkovic/flow-hooks/master)](https://codecov.io/gh/radenkovic/flow-hooks)
[![types](https://img.shields.io/npm/types/flow-hooks)](https://www.npmjs.com/package/flow-hooks?activeTab=code)
[![bundle size](https://img.shields.io/bundlejs/size/flow-hooks)](https://bundlejs.com/?q=flow-hooks)
[![license](https://img.shields.io/npm/l/flow-hooks)](https://github.com/radenkovic/flow-hooks/blob/master/LICENSE)

flow-hooks lets you write async logic as **a list of small steps** instead of one long function. Each step (a **hook**) receives a frozen **context** object and returns the next one, like a reducer.

```js
import { cancel, flow, when } from 'flow-hooks';

const checkout = [
  when((ctx) => ctx.items.length === 0, cancel()), // stop early
  (ctx) => ({ ...ctx, total: ctx.items.reduce((sum, i) => sum + i.price, 0) }),
  when(
    (ctx) => ctx.coupon === 'SAVE10',
    (ctx) => ({ ...ctx, total: ctx.total * 0.9 }),
  ),
  (ctx) => {
    console.log(`Charging $${ctx.total}`); // side effect: return nothing
  },
];

const order = await flow(checkout, {
  items: [{ price: 60 }, { price: 40 }],
  coupon: 'SAVE10',
});
// Charging $90

order.total; // 90
```

## Where it fits

Anywhere a process is a series of async steps with branches, parallel work and early exits:

- **Request handlers:** authenticate, validate, load, respond.
- **Business workflows:** checkout, sign-up, onboarding, fulfilment.
- **Data loading:** several sources in parallel, with fallbacks and timeouts.
- **Background jobs and webhooks:** skip duplicates, retry flaky calls, stop cleanly on shutdown.

What you get over one long `async` function:

- **You can read the process at a glance.** The flow is a list of named steps.
- **Each step is easy to test.** A hook is a plain function: call it with an object and check the result.
- **Steps can't interfere.** The context is frozen, so no step can change data another one is holding.
- **Cancellation reaches everything.** One `AbortSignal` goes to every hook, and leftover parallel work is aborted.

## Install

```bash
npm install flow-hooks
```

```js
import { flow, when, any, every, cancel } from 'flow-hooks'; // ESM / TypeScript
const { flow, when, any, every, cancel } = require('flow-hooks'); // CommonJS
```

Typed, no runtime dependencies, Node.js 22+ and modern browsers.

## Where to go next

- **New here?** [Getting started](getting-started.md) teaches the whole library in nine short, runnable steps.
- **Want to see real code?** [Examples](examples.md) are complete programs: an HTTP handler, a webhook worker, parallel loading, retries and tests.
- **Solving a specific problem?** [Recipes](recipes.md) has retries, timeouts, fallbacks, if/else, caching, logging, Express and React.
- **Something not working?** [Common mistakes](mistakes.md) lists the errors you're most likely to see.
- **Need the details?** [Core concepts](guide.md), [API](api.md) and [TypeScript](typescript.md).
