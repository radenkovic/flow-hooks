# Changelog

## 2.0.0

Rewritten in TypeScript around an **immutable, reducer-style context**. There are no runtime dependencies (`bluebird` was removed), and the package ships ESM, CommonJS and type declarations.

### Breaking changes

- **Requires Node.js 22+.**
- **The context is immutable.** Hooks receive a deeply frozen context and return the next one (`ctx => ({ ...ctx, total: 42 })`) instead of mutating it. Mutating it throws a `TypeError` in strict mode.
- **Hook return values:**
  - a plain object becomes the next context;
  - `undefined` keeps the current context;
  - anything else rejects the flow with a `TypeError` that names the hook.

  In 1.x any truthy value replaced the context, so `ctx => ctx.list.push(x)` silently wiped it.

- **The initial context is copied**, so the object you pass in is never changed or frozen.
- **`cancel()` inside `when(cond, [...])` now cancels the whole flow.** In 1.x it only stopped the nested sequence.
- **`any()` and `every()` start all hooks in parallel.** In 1.x a hook that threw synchronously stopped the hooks after it from starting.
- **`any()`:**
  - The winning hook's return value becomes the next context.
  - A cancel (sync or async) cancels the flow if it happens before any hook succeeds; in 1.x an async cancel was silently ignored.
  - If every hook fails, the flow rejects with an `AggregateError`.
- **`every()`:** each hook returns its next context. The changes are merged key by key, and the later hook wins when two change the same key.
- **Invalid input** (not an array, or entries that aren't functions) throws a `TypeError` when `flow()`, `when()`, `any()` or `every()` is called, and the message includes the index of the bad entry. `any([])` throws.

### Added

- `runFlow()` resolves with `{ context, cancelled }`.
- `CancelError` and `isCancelError()` are exported.
- Hooks receive a second argument `{ signal }`, an `AbortSignal`.
- `flow(hooks, ctx, { signal })` aborts a running flow.
- `any()` aborts the losing hooks, and `every()` aborts the remaining hooks when one fails.
- Full TypeScript types, with a generic context: `flow<MyContext>(...)`. Hooks receive `Immutable<C>`, so mutations are compile errors.

## 1.0.1

Initial release.
