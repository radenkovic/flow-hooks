# TypeScript

flow-hooks is written in TypeScript and ships its own types. You don't need an `@types` package.

## Default context

Without a type argument, the context is `Record<string, any>`. That's convenient for scripts and quick flows:

```ts
const ctx = await flow([(ctx) => ({ ...ctx, anything: 1 })]);
```

The context type is never inferred from what hooks return, so adding keys in one hook doesn't cause type errors in the next.

## Typed context

Describe the context once and pass it as a type argument. Every hook, condition and helper in the array is then checked against it:

```ts
import { flow, when, every, type Hook } from 'flow-hooks';

interface Order {
  id: string;
  total: number;
  items: { sku: string; qty: number }[];
  customer?: Customer;
  paid?: boolean;
}

const order = await flow<Order>(
  [
    every([loadCustomer, reserveStock]),
    when((order) => order.total > 0, charge),
    (order) => ({ ...order, paid: true }),
  ],
  { id: 'o_1', total: 42, items: [] },
);
// order: Immutable<Order>
```

- The initial context is typed as `Partial<Order>`, because flows usually build the context up step by step. Fields that are filled in later should be optional in the interface.
- Hooks must return a **complete** context (`Immutable<Order>`) or nothing. Forgetting `...order` is a compile error.

## Immutable context

Hooks receive `Immutable<C>`, a deeply readonly version of your type that matches what flow-hooks freezes at runtime. Mutations are compile errors:

```ts
const hook: Hook<Order> = (order) => {
  order.paid = true; // ✗ Cannot assign to 'paid' because it is a read-only property
  order.items.push(item); // ✗ Property 'push' does not exist on type 'readonly ...[]'
  return { ...order, items: [...order.items, item] }; // ✓
};
```

Functions and class instances such as `Date`, `Map`, `Set` and `AbortSignal` keep their own types, because they aren't frozen at runtime.

`Immutable` is exported if you need it in your own signatures:

```ts
import type { Immutable } from 'flow-hooks';

function summarize(order: Immutable<Order>): string {
  return `${order.id}: ${order.items.length} items`;
}
```

## Typing hooks you define separately

Annotate standalone hooks with `Hook<C>`. `flow()` then infers the context type from them:

```ts
const loadCustomer: Hook<Order> = async (order, { signal }) => ({
  ...order,
  customer: await customers.byOrder(order.id, { signal }),
});

const charge: Hook<Order> = async (order) => {
  await payments.charge(order.customer!.id, order.total);
};

await flow([loadCustomer, charge], { id: 'o_1', total: 42, items: [] }); // Promise<Immutable<Order>>
```

## Generic hook factories

Factories that work with any context take a type parameter:

```ts
import { isCancelError, type Hook } from 'flow-hooks';

export const retry =
  <C extends object>(hook: Hook<C>, attempts = 3): Hook<C> =>
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
```

## Exported types

| Type             | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| `Hook<C>`        | `(ctx: Immutable<C>, api: HookApi) => HookResult<C>` (or a promise of it) |
| `HookResult<C>`  | `Immutable<C> \| undefined`                                               |
| `Condition<C>`   | Predicate passed to `when()`                                              |
| `Immutable<T>`   | Deeply readonly plain objects and arrays                                  |
| `HookApi`        | `{ signal: AbortSignal }`                                                 |
| `FlowOptions`    | `{ signal?: AbortSignal }`                                                |
| `FlowResult<C>`  | `{ context: Immutable<C>; cancelled: boolean }`                           |
| `DefaultContext` | `Record<string, any>`                                                     |
