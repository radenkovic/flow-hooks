# Common mistakes

Most problems with flow-hooks come from a handful of mistakes. Each one below shows the error you'll see and the fix.

## Changing the context instead of returning a new one

```js
(ctx) => {
  ctx.total = 120;
};
// TypeError: Cannot add property total, object is not extensible

(ctx) => {
  ctx.items.push(item);
};
// TypeError: Cannot add property 0, object is not extensible
```

The context is frozen, including the objects and arrays inside it. Return a new one:

```js
(ctx) => ({ ...ctx, total: 120 });
(ctx) => ({ ...ctx, items: [...ctx.items, item] });
```

!> In non-strict CommonJS scripts, writes to a frozen object are **silently ignored** instead of throwing. ES modules, TypeScript output and files with `'use strict'` are strict.

## An arrow function that returns something by accident

```js
(ctx) => cache.set(ctx.key, ctx.value);
// TypeError: Hook at index 2 must return a new context object or undefined, got an instance of Map
```

Arrow functions without braces return their expression. `Map#set` returns the map, so the hook returns a `Map`. Add braces so it returns nothing:

```js
(ctx) => {
  cache.set(ctx.key, ctx.value);
};
```

## `cancel` without parentheses

```js
when((ctx) => ctx.items.length === 0, cancel);
// TypeError: Hook at index 0 must return a new context object or undefined, got function
```

`cancel()` **creates** a hook. Call it:

```js
when((ctx) => ctx.items.length === 0, cancel());
```

## Forgetting to spread `ctx` in `every()`

```js
every([
  async (ctx) => ({ ...ctx, user: await getUser(ctx.id) }),
  async (ctx) => ({ posts: await getPosts(ctx.id) }), // ✗ no ...ctx
]);
// The next context is { user, posts }. `id` and every other key are gone.
```

`every()` merges what each hook **changed**. A key a hook leaves out counts as removed. Always start from `...ctx`:

```js
async (ctx) => ({ ...ctx, posts: await getPosts(ctx.id) });
```

## A wrapper that doesn't return

```js
const logged = (hook) => async (ctx, api) => {
  console.log('start');
  await hook(ctx, api); // ✗ the result is thrown away
};
```

The flow continues with the old context, as if the wrapped hook did nothing. Return the result:

```js
const logged = (hook) => async (ctx, api) => {
  console.log('start');
  return hook(ctx, api);
};
```

## Two `when()`s as an if/else

```js
when((ctx) => !ctx.user.verified, sendVerificationEmail),
when((ctx) => ctx.user.verified, sendWelcomeEmail),
```

This works only if the first branch doesn't change `verified`. The second condition sees the context the first branch **returned**, so if it did change it, both branches run. Pick the branch once with the [`ifElse()` recipe](recipes.md#if-else-and-switch).

## Treating a cancel as a failure in your own wrappers

```js
const retry = (hook) => async (ctx, api) => {
  try {
    return await hook(ctx, api);
  } catch {
    return hook(ctx, api); // ✗ also retries cancel()
  }
};
```

`cancel()` works by throwing a `CancelError`. Wrappers that catch errors should let it through:

```js
import { isCancelError } from 'flow-hooks';

} catch (error) {
  if (isCancelError(error)) throw error;
  // ...
}
```

The [recipes](recipes.md) all do this already.

## Checking `error.name` to detect a timeout

```js
try {
  await flow(hooks, ctx, { signal: AbortSignal.timeout(5_000) });
} catch (error) {
  if (error.name !== 'TimeoutError') throw error; // ✗ not always a TimeoutError
  showTimeoutMessage();
}
```

When a flow is aborted while a hook is running, the flow rejects with whatever that hook threw. `fetch` throws the signal's `TimeoutError`, but Node's timers throw `AbortError`, and other libraries throw their own errors. Keep the signal and check it instead:

```js
const deadline = AbortSignal.timeout(5_000);
try {
  await flow(hooks, ctx, { signal: deadline });
} catch (error) {
  if (!deadline.aborted) throw error; // ✓
  showTimeoutMessage();
}
```

## Not passing `signal` down

```js
async (ctx) => ({ ...ctx, data: await fetch(url).then((r) => r.json()) });
```

This works, but a timeout, `any()` or `every()` can't stop the request: it keeps running in the background after the flow has given up on it. Pass the signal along:

```js
async (ctx, { signal }) => ({
  ...ctx,
  data: await fetch(url, { signal }).then((r) => r.json()),
});
```

## Expecting the initial object to change

```js
const order = { items };
await flow(hooks, order);
order.total; // undefined
```

The initial context is **copied**, and your object is never changed. Use the value `flow()` resolves with:

```js
const result = await flow(hooks, { items });
result.total;
```
