# Core concepts

## Hooks

A hook is a function that receives the current context and an `api` object, and returns the next context. It can be sync or async.

```ts
const loadUser = async (ctx, { signal }) => ({
  ...ctx,
  user: await db.users.find(ctx.userId, { signal }),
});
```

`flow()` runs hooks one after another. Each hook receives what the previous one returned:

```ts
const ctx = await flow([loadUser, loadPermissions, render], { userId: 7 });
```

## The context is immutable

The context is a plain object that carries data from one hook to the next. flow-hooks **freezes** it, including every plain object and array inside it. Hooks never change it; they return a new one.

```ts
flow([
  (ctx) => {
    ctx.total = 10; // ✗ TypeError: Cannot add property total, object is not extensible
  },
  (ctx) => ({ ...ctx, total: 10 }), // ✓
]);
```

This works like a reducer in Redux or React's `useReducer`: no hook can change data that an earlier hook, a parallel hook or the caller is still holding.

!> Writes to a frozen object only throw in **strict mode**. ES modules, TypeScript output and files starting with `'use strict'` are strict. In a non-strict CommonJS script, a mutation is silently ignored instead. With TypeScript, mutations are also compile errors.

### Return values

| Hook returns                              | Result                                   |
| ----------------------------------------- | ---------------------------------------- |
| a plain object `{ ... }`                  | becomes the next context (and is frozen) |
| `undefined` (nothing)                     | the context stays the same               |
| a promise                                 | awaited, then the same rules apply       |
| anything else (number, array, `Map`, ...) | the flow rejects with a `TypeError`      |

Returning `undefined` is for steps that only have side effects:

```ts
flow([
  loadOrder,
  async (ctx) => {
    await mailer.send(ctx.order.email, 'Your order is on its way');
  },
  (ctx) => {
    logger.info('order processed', { id: ctx.order.id });
  },
]);
```

?> Watch out for arrow functions without braces: `(ctx) => cache.set(ctx.key, ctx.value)` returns the `Map`, which is rejected. Use braces for side effects: `(ctx) => { cache.set(ctx.key, ctx.value); }`.

### Updating nested data

Copy each level you change:

```ts
(ctx) => ({
  ...ctx,
  user: { ...ctx.user, verified: true },
  tags: [...ctx.tags, 'verified'],
});
```

To remove a key, leave it out:

```ts
(ctx) => {
  const { password, ...rest } = ctx;
  return rest;
};
```

### What gets frozen

- **Plain objects and arrays** in the context are frozen, however deeply nested.
- **Class instances** (`Date`, `Map`, `Set`, a request object, a database client) and **functions** are kept by reference and **not** frozen, so you can still call their methods.
- **The initial context you pass in** is copied first, so your own object is never frozen or changed.
- **Objects a hook returns** are frozen in place. Don't return an object you plan to change later; spread it into a new one instead.

Frozen values are recognised, so passing the result of one flow into another doesn't copy anything:

```ts
const user = await flow(loadUserHooks, { id });
const page = await flow(renderHooks, user); // no copy; `user` is already frozen
```

## Stopping a flow

There are three ways for a flow to stop before the last hook:

| How                                     | `flow()` result              | Use it for                  |
| --------------------------------------- | ---------------------------- | --------------------------- |
| `cancel()` or `throw new CancelError()` | resolves with the context    | "nothing more to do"        |
| `cancel(error)` or `throw error`        | rejects with `error`         | failures, validation errors |
| `options.signal` aborted                | rejects with `signal.reason` | timeouts, user cancellation |

### Cancelling

A cancelled flow resolves normally, with the context the cancelling hook received. Use `runFlow()` when you need to know whether it was cancelled:

```ts
import { cancel, runFlow, when } from 'flow-hooks';

const { context, cancelled } = await runFlow(
  [
    when(
      (ctx) => cache.has(ctx.key),
      [
        (ctx) => ({ ...ctx, value: cache.get(ctx.key) }),
        cancel(), // skip the expensive part
      ],
    ),
    computeValue,
    storeInCache,
  ],
  { key },
);
```

A cancel anywhere stops the **whole** flow, including from inside `when()`, `any()` and `every()`.

### Failing

Any error thrown by a hook stops the flow, and `flow()` rejects with it. `cancel(error)` is a shortcut for a hook that throws `error`:

```ts
when((ctx) => !ctx.user, cancel(new UnauthorizedError()));
```

### Aborting

Pass an `AbortSignal` to stop the flow from the outside. The flow checks the signal before and after every hook, and hooks receive it as `api.signal` so they can stop work that's already running:

```ts
const controller = new AbortController();
cancelButton.onclick = () => controller.abort();

await flow(
  [
    async (ctx, { signal }) => {
      const response = await fetch(`/search?q=${ctx.query}`, { signal });
      return { ...ctx, results: await response.json() };
    },
  ],
  { query },
  { signal: controller.signal },
);
```

## Branching and parallel steps

| Helper              | Runs                             | Continues when                  |
| ------------------- | -------------------------------- | ------------------------------- |
| `when(cond, hooks)` | `hooks` in order, only if `cond` | the hooks are done (or skipped) |
| `any([...hooks])`   | all hooks at the same time       | the **first** hook succeeds     |
| `every([...hooks])` | all hooks at the same time       | **all** hooks succeed           |

These helpers return hooks too, so they nest freely:

```ts
flow([
  parseRequest,
  when(
    (ctx) => ctx.user.isAdmin,
    [every([loadAuditLog, loadBilling]), any([fromCache, fromDatabase])],
  ),
  render,
]);
```

### Merging in every()

All `every()` hooks receive the **same** context, and each returns its own next context. flow-hooks merges them **key by key**: it compares each result with the shared starting context and applies only what that hook added, changed or removed.

```ts
every([
  async (ctx, { signal }) => ({
    ...ctx,
    user: await getUser(ctx.id, { signal }),
  }),
  async (ctx, { signal }) => ({
    ...ctx,
    posts: await getPosts(ctx.id, { signal }),
  }),
]);
// next context: { ...ctx, user, posts }
```

So two hooks that each spread `ctx` don't overwrite each other. If two hooks change the **same** key, the later one in the array wins.

!> A key that a hook leaves out counts as removed. Always spread `ctx` (`{ ...ctx, user }`), not just `{ user }`, or that hook will remove every other key.

## Errors at definition time

Helpers check their arguments when they are **called**, not when the flow runs, so mistakes show up immediately:

```ts
when(true, []); // TypeError: when() expects a condition function
any([]); // TypeError: any() expects at least one hook
every([fn, undefined]); // TypeError: ... got undefined at index 1
```
