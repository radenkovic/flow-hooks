// Running steps in parallel.
//   every([...]) waits for all hooks and merges what each one added.
//   any([...])   continues with the first hook that succeeds and aborts the rest.
//
// Run it: npm run example examples/03-parallel.ts

import { setTimeout as sleep } from 'node:timers/promises';
import { any, every, flow, type Hook } from 'flow-hooks';

// --- Pretend services -------------------------------------------------------

const api = {
  async product(id: string, signal: AbortSignal) {
    await sleep(30, undefined, { signal });
    return { id, name: 'Espresso machine' };
  },
  async reviews(signal: AbortSignal) {
    await sleep(20, undefined, { signal });
    return [5, 4, 5];
  },
  async stock(signal: AbortSignal) {
    await sleep(10, undefined, { signal });
    return 3;
  },
};

// A price service with three mirrors: one is down, one is slow, one is fast.
function priceFrom(mirror: string, delay: number, up = true): Hook<Page> {
  return async (ctx, { signal }) => {
    let settled = false;
    signal.addEventListener('abort', () => {
      if (!settled) console.log(`  ${mirror}: still waiting, aborted`);
    });
    await sleep(delay, undefined, { signal });
    settled = true;
    if (!up) throw new Error(`${mirror} is down`);
    return { ...ctx, price: 499, priceFrom: mirror };
  };
}

// --- The flow ---------------------------------------------------------------

interface Page {
  productId: string;
  product?: { id: string; name: string };
  reviews?: number[];
  stock?: number;
  price?: number;
  priceFrom?: string;
}

const page = await flow<Page>(
  [
    // All three requests start at once. Each hook spreads `ctx` and adds its
    // own key; every() merges them into one context.
    every([
      async (ctx, { signal }) => ({
        ...ctx,
        product: await api.product(ctx.productId, signal),
      }),
      async (ctx, { signal }) => ({
        ...ctx,
        reviews: await api.reviews(signal),
      }),
      async (ctx, { signal }) => ({ ...ctx, stock: await api.stock(signal) }),
    ]),

    () => {
      console.log('Fetching price from three mirrors...');
    },

    // The first mirror to answer wins and the others are aborted. A failure
    // is ignored as long as another mirror can still succeed.
    any([
      priceFrom('mirror-a', 5, false),
      priceFrom('mirror-b', 200),
      priceFrom('mirror-c', 20),
    ]),
  ],
  { productId: 'p_42' },
);

console.log(`${String(page.product?.name)}: $${String(page.price)}`);
console.log(`Price from ${String(page.priceFrom)}`);
console.log(`Reviews: ${String(page.reviews?.join(', '))}`);
console.log(`In stock: ${String(page.stock)}`);

/* Output:
Fetching price from three mirrors...
  mirror-b: still waiting, aborted
Espresso machine: $499
Price from mirror-c
Reviews: 5, 4, 5
In stock: 3
*/
