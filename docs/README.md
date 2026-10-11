# flow-hooks

> Composable async flows built from small, immutable steps: sequence, branch, race and run in parallel, with cancellation built in.

[![npm version](https://img.shields.io/npm/v/flow-hooks)](https://www.npmjs.com/package/flow-hooks)
[![CI](https://img.shields.io/github/actions/workflow/status/radenkovic/flow-hooks/ci.yml?branch=master&label=CI)](https://github.com/radenkovic/flow-hooks/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/radenkovic/flow-hooks/master)](https://codecov.io/gh/radenkovic/flow-hooks)
[![types](https://img.shields.io/npm/types/flow-hooks)](https://www.npmjs.com/package/flow-hooks?activeTab=code)
[![bundle size](https://img.shields.io/bundlejs/size/flow-hooks)](https://bundlejs.com/?q=flow-hooks)
[![license](https://img.shields.io/npm/l/flow-hooks)](https://github.com/radenkovic/flow-hooks/blob/master/LICENSE)

flow-hooks lets you write async logic as a list of small, named steps instead of one long function. Each step (a **hook**) receives an immutable **context** and returns the next one, like a reducer. Steps can run conditionally or in parallel, and the flow can stop early, with or without an error.

```ts
import { cancel, every, flow, when } from 'flow-hooks';

const checkout = [
  validateCart,
  when((ctx) => ctx.cart.items.length === 0, cancel()),
  every([reserveStock, calculateShipping]),
  chargeCard,
  sendConfirmation,
];

const order = await flow(checkout, { cart, user });
```

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

```bash
npm install flow-hooks
```

```ts
// ESM / TypeScript
import { flow, when, any, every, cancel } from 'flow-hooks';

// CommonJS
const { flow, when, any, every, cancel } = require('flow-hooks');
```

## Quick start

```ts
import { flow, when } from 'flow-hooks';

const greeting = await flow(
  [
    (ctx) => ({ ...ctx, name: ctx.name.trim() }),
    when(
      (ctx) => ctx.name === '',
      (ctx) => ({ ...ctx, name: 'stranger' }),
    ),
    (ctx) => ({ ...ctx, message: `Hello, ${ctx.name}!` }),
  ],
  { name: '  ' },
);

greeting.message; // 'Hello, stranger!'
Object.isFrozen(greeting); // true
```

Every hook is just `(ctx, api) => nextCtx`, so a flow is an array you can build, spread and reuse:

```ts
const authenticate = [readSession, loadUser, requireRole('admin')];

await flow([...authenticate, deleteProject], { req });
```

## Next steps

- [Core concepts](guide.md): how the context, return values, errors and cancellation work.
- [API reference](api.md): every function and type.
- [Recipes](recipes.md): retries, timeouts, caching, fallbacks, HTTP handlers and more.
- [TypeScript](typescript.md): typing your context.
