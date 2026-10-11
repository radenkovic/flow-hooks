// The basics: a flow is a list of steps (hooks). Each hook gets the current
// context and returns the next one.
//
// Run it: npm run example examples/01-basics.ts

import { flow, when } from 'flow-hooks';

interface Cart {
  items: { name: string; price: number; qty: number }[];
  coupon?: string;
  subtotal?: number;
  discount?: number;
  total?: number;
}

const receipt = await flow<Cart>(
  [
    // 1. Return a new context to pass data to the next hook.
    (cart) => ({
      ...cart,
      subtotal: cart.items.reduce(
        (sum, item) => sum + item.price * item.qty,
        0,
      ),
    }),

    // 2. when() runs a hook only if the condition is true.
    when(
      (cart) => cart.coupon === 'SAVE10',
      (cart) => ({ ...cart, discount: (cart.subtotal ?? 0) * 0.1 }),
    ),

    (cart) => ({
      ...cart,
      total: (cart.subtotal ?? 0) - (cart.discount ?? 0),
    }),

    // 3. Return nothing for side effects. The context stays the same.
    (cart) => {
      console.log(`Charging $${String(cart.total)}`);
    },
  ],
  {
    items: [
      { name: 'Coffee', price: 12, qty: 2 },
      { name: 'Mug', price: 16, qty: 1 },
    ],
    coupon: 'SAVE10',
  },
);

console.log(`Subtotal $${String(receipt.subtotal)}`);
console.log(`Discount $${String(receipt.discount)}`);
console.log(`Total    $${String(receipt.total)}`);

// The result is frozen, and so is every plain object and array inside it.
console.log(
  'Frozen:',
  Object.isFrozen(receipt),
  Object.isFrozen(receipt.items),
);

/* Output:
Charging $36
Subtotal $40
Discount $4
Total    $36
Frozen: true true
*/
