import { describe, expectTypeOf, it } from 'vitest';
import {
  any,
  cancel,
  every,
  flow,
  runFlow,
  when,
  type FlowResult,
  type Hook,
  type HookApi,
  type Immutable,
} from '../src';

interface Order {
  id: string;
  total: number;
  items: { sku: string; qty: number }[];
  placedAt?: Date;
  paid?: boolean;
}

describe('types', () => {
  it('uses a loose context by default', () => {
    expectTypeOf(flow([(ctx) => ({ ...ctx, anything: 1 })])).toEqualTypeOf<
      Promise<Immutable<Record<string, any>>>
    >();
  });

  it('gives hooks a deeply readonly context', () => {
    void flow<Order>([
      (order, api) => {
        expectTypeOf(order).toEqualTypeOf<Immutable<Order>>();
        expectTypeOf(api).toEqualTypeOf<HookApi>();
        expectTypeOf(order.items).toEqualTypeOf<
          readonly { readonly sku: string; readonly qty: number }[]
        >();
        // Class instances keep their own type.
        expectTypeOf(order.placedAt).toEqualTypeOf<Date | undefined>();
        // @ts-expect-error -- the context is readonly
        order.paid = true;
        // @ts-expect-error -- nested arrays are readonly
        order.items.push({ sku: 'x', qty: 1 });
        const [first] = order.items;
        if (first) {
          // @ts-expect-error -- nested objects are readonly
          first.qty = 2;
        }
      },
    ]);
  });

  it('accepts hooks that return the next context or nothing', () => {
    const result = flow<Order>(
      [
        (order) => ({ ...order, paid: true }),
        async (order) => ({ ...order, total: await Promise.resolve(10) }),
        () => undefined,
        async () => {
          await Promise.resolve();
        },
        () => {
          // side effect only
        },
        when(
          (order) => order.total > 100,
          [(order) => ({ ...order, items: [...order.items] })],
        ),
        any([(order) => order]),
        every([(order) => ({ ...order, paid: false })]),
        cancel(),
      ],
      { id: 'a' },
    );
    expectTypeOf(result).toEqualTypeOf<Promise<Immutable<Order>>>();
  });

  it('rejects hooks that return something other than a context', () => {
    // @ts-expect-error -- a number is not a context
    void flow<Order>([() => 1]);
    // @ts-expect-error -- missing required keys
    void flow<Order>([() => ({ id: 'a' })]);
  });

  it('infers the context from annotated hooks', () => {
    const markPaid: Hook<Order> = (order) => ({ ...order, paid: true });
    expectTypeOf(flow([markPaid])).toEqualTypeOf<Promise<Immutable<Order>>>();
    expectTypeOf(runFlow([markPaid])).toEqualTypeOf<
      Promise<FlowResult<Order>>
    >();
  });

  it('accepts a partial initial context, including a previous result', async () => {
    void flow<Order>([], { id: 'a' });
    // @ts-expect-error -- wrong property type
    void flow<Order>([], { id: 1 });
    const previous = await flow<Order>([]);
    void flow<Order>([], previous);
  });

  it('rejects hooks for an unrelated context', () => {
    const other: Hook<{ name: string }> = () => undefined;
    // @ts-expect-error -- incompatible hook
    void flow<Order>([other]);
  });
});
