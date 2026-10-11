// Testing. A hook is a plain function, so you can test it by calling it with
// a plain object. No mocks of flow-hooks needed. This uses node:assert, but
// the same works in Vitest, Jest or node:test.
//
// Run it: npm run example examples/07-testing.ts

import assert from 'node:assert/strict';
import {
  flow,
  runFlow,
  when,
  cancel,
  type Hook,
  type HookApi,
} from 'flow-hooks';

// --- Code under test --------------------------------------------------------

interface Order {
  items: { price: number; qty: number }[];
  total?: number;
  freeShipping?: boolean;
}

const addTotal: Hook<Order> = (order) => ({
  ...order,
  total: order.items.reduce((sum, item) => sum + item.price * item.qty, 0),
});

const freeShippingOver50: Hook<Order> = (order) => ({
  ...order,
  freeShipping: (order.total ?? 0) >= 50,
});

const checkout: Hook<Order>[] = [
  when((order) => order.items.length === 0, cancel()),
  addTotal,
  freeShippingOver50,
];

// --- Tests ------------------------------------------------------------------

// Hooks receive `{ signal }` as a second argument. Make one for tests.
const api: HookApi = { signal: new AbortController().signal };

// 1. Test a single hook: call it.
assert.deepEqual(addTotal({ items: [{ price: 20, qty: 2 }] }, api), {
  items: [{ price: 20, qty: 2 }],
  total: 40,
});
console.log('ok - addTotal sums the items');

// 2. Test a few hooks together: run them as a small flow.
const result = await flow([addTotal, freeShippingOver50], {
  items: [{ price: 30, qty: 2 }],
});
assert.equal(result.freeShipping, true);
console.log('ok - orders over $50 ship free');

// 3. Test the whole flow, including early exits.
const { cancelled } = await runFlow(checkout, { items: [] });
assert.equal(cancelled, true);
console.log('ok - empty orders stop early');

/* Output:
ok - addTotal sums the items
ok - orders over $50 ship free
ok - empty orders stop early
*/
