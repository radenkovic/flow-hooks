# API reference

## flow()

```ts
flow<C>(hooks: Hook<C>[], initialContext?: Partial<C>, options?: FlowOptions): Promise<Immutable<C>>
```

Runs `hooks` in order and resolves with the final context. Each hook receives the context the previous hook returned.

| Parameter        | Description                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `hooks`          | Array of hooks. Validated immediately.                                                      |
| `initialContext` | Starting context, a plain object. It is copied and frozen, never changed. Defaults to `{}`. |
| `options.signal` | `AbortSignal` that aborts the flow.                                                         |

- **Resolves** with the final frozen context, or with the context at the moment of a cancel.
- **Rejects** with:
  - the error a hook threw;
  - `signal.reason`, if the flow was aborted;
  - a `TypeError`, if the input is invalid or a hook returns something other than a plain object or `undefined`.

```ts
const ctx = await flow([loadUser, loadOrders], { userId: 1 });
```

## runFlow()

```ts
runFlow<C>(hooks: Hook<C>[], initialContext?: Partial<C>, options?: FlowOptions): Promise<FlowResult<C>>
```

Same as `flow()`, but resolves with `{ context, cancelled }` so you can tell a completed flow from a cancelled one.

```ts
const { context, cancelled } = await runFlow(hooks, { id });

if (cancelled) {
  console.log('stopped early with', context);
}
```

## when()

```ts
when<C>(condition: Condition<C>, hooks: Hook<C> | Hook<C>[]): Hook<C>
```

Returns a hook that runs `hooks` only when `condition(ctx, api)` is truthy, or resolves to a truthy value. When the condition is falsy, the context stays the same.

- With a single hook, it behaves like that hook.
- With an array, the hooks run in order like a nested flow, and the last context they produce becomes the next context.
- A cancel inside stops the **whole** flow.
- Throws a `TypeError` immediately if the arguments are invalid.

```ts
when((ctx) => ctx.user.isAdmin, loadAdminData);

when(
  async (ctx) => await featureFlags.isEnabled('new-checkout', ctx.user),
  [newCheckout, trackExperiment],
);
```

## any()

```ts
any<C>(hooks: Hook<C>[]): Hook<C>
```

Returns a hook that starts all `hooks` at the same time, with the same context, and continues as soon as **one succeeds**. That hook's return value becomes the next context.

- The remaining hooks get an aborted `api.signal`, so they can stop their work.
- A hook that fails is ignored while another can still succeed. A hook that returns an invalid value counts as failed.
- If **every** hook fails, the flow rejects with an `AggregateError` whose `errors` are in hook order.
- A cancel that happens before any hook succeeds cancels the flow. Cancels after that are ignored.
- Throws a `TypeError` immediately for an empty array.

```ts
const fetchFrom =
  (url) =>
  async (ctx, { signal }) => {
    const response = await fetch(url, { signal });
    return { ...ctx, data: await response.json() };
  };

any([fetchFrom(PRIMARY_URL), fetchFrom(MIRROR_URL)]);
```

## every()

```ts
every<C>(hooks: Hook<C>[]): Hook<C>
```

Returns a hook that starts all `hooks` at the same time, with the same context, and waits for **all of them**.

- Each hook returns its own next context, or `undefined`. The results are merged **key by key** against the shared starting context: whatever a hook added, changed or removed is applied. If two hooks change the same key, the later one in the array wins.
- If a hook throws or cancels, the others get an aborted `api.signal`, and the flow fails or cancels right away.
- An empty array, or hooks that all return `undefined`, keep the context as it is.

```ts
every([
  async (ctx) => ({ ...ctx, profile: await getProfile(ctx.id) }),
  async (ctx) => ({ ...ctx, friends: await getFriends(ctx.id) }),
]);
```

!> A key a hook leaves out counts as removed, so always spread `ctx`.

## cancel()

```ts
cancel<C>(error?: Error): Hook<C>
```

Returns a hook that stops the flow.

- `cancel()` stops the flow without failing. `flow()` resolves with the current context.
- `cancel(error)` stops the flow by throwing `error`. `flow()` rejects with it.

```ts
when((ctx) => ctx.items.length === 0, cancel());
when((ctx) => !ctx.user, cancel(new Error('Not signed in')));
```

## CancelError

```ts
class CancelError extends Error {
  constructor(message?: string); // default: 'Flow cancelled'
}
```

Throw it from any hook to cancel the flow. This is what `cancel()` throws.

```ts
async (ctx) => {
  if (await alreadyProcessed(ctx.id)) throw new CancelError('Duplicate event');
};
```

## isCancelError()

```ts
isCancelError(error: unknown): error is CancelError
```

Returns `true` for a `CancelError`. It works across copies of the package, for example when the ESM and CommonJS builds are both loaded. Use it in your own wrappers so a cancel isn't treated as a failure:

```ts
try {
  return await hook(ctx, api);
} catch (error) {
  if (!isCancelError(error)) report(error);
  throw error;
}
```

## Types

```ts
type Hook<C = DefaultContext> = (
  ctx: Immutable<C>,
  api: HookApi,
) => HookResult<C> | Promise<HookResult<C>>;

type HookResult<C> = Immutable<C> | undefined;

type Condition<C = DefaultContext> = (ctx: Immutable<C>, api: HookApi) => unknown;

type Immutable<T>; // deeply readonly plain objects and arrays

interface HookApi {
  readonly signal: AbortSignal;
}

interface FlowOptions {
  signal?: AbortSignal;
}

interface FlowResult<C> {
  context: Immutable<C>;
  cancelled: boolean;
}

type DefaultContext = Record<string, any>;
```

See [TypeScript](typescript.md) for usage.
