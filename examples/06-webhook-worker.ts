// A background worker that processes webhook events: skip duplicates and
// events it doesn't care about, do the work in parallel, and stop cleanly
// when the process is shutting down.
//
// Run it: npm run example examples/06-webhook-worker.ts

import { setTimeout as sleep } from 'node:timers/promises';
import {
  CancelError,
  cancel,
  every,
  runFlow,
  when,
  type Hook,
} from 'flow-hooks';

// --- Pretend services -------------------------------------------------------

const processed = new Set<string>();
const paidOrders = new Set<string>();

async function sendReceipt(
  orderId: string,
  signal: AbortSignal,
): Promise<void> {
  // The receipt for o_3 is slow, so shutdown happens while it's being sent.
  await sleep(orderId === 'o_3' ? 1_000 : 1, undefined, { signal });
}

// --- The flow ---------------------------------------------------------------

interface Job {
  event: { id: string; type: string; orderId: string };
  receiptSent?: boolean;
}

const handleEvent: Hook<Job>[] = [
  // Webhooks are often delivered twice. Throwing CancelError from any hook
  // stops the flow without failing it, just like cancel().
  (ctx) => {
    if (processed.has(ctx.event.id)) throw new CancelError('duplicate');
  },

  when((ctx) => ctx.event.type !== 'payment.succeeded', cancel()),

  every([
    (ctx) => {
      paidOrders.add(ctx.event.orderId);
    },
    async (ctx, { signal }) => {
      await sendReceipt(ctx.event.orderId, signal);
      return { ...ctx, receiptSent: true };
    },
  ]),

  (ctx) => {
    processed.add(ctx.event.id);
  },
];

// --- The worker -------------------------------------------------------------

const queue: Job['event'][] = [
  { id: 'evt_1', type: 'payment.succeeded', orderId: 'o_1' },
  { id: 'evt_1', type: 'payment.succeeded', orderId: 'o_1' },
  { id: 'evt_2', type: 'refund.created', orderId: 'o_2' },
  { id: 'evt_3', type: 'payment.succeeded', orderId: 'o_3' },
];

// In a real worker: process.on('SIGTERM', () => shutdown.abort())
const shutdown = new AbortController();
setTimeout(() => {
  shutdown.abort();
}, 50);

for (const event of queue) {
  try {
    const { context, cancelled } = await runFlow(
      handleEvent,
      { event },
      { signal: shutdown.signal }, // reaches every hook as `api.signal`
    );
    if (cancelled) {
      console.log(`${event.id}: skipped`);
    } else {
      console.log(
        `${event.id}: ${event.orderId} paid, receipt sent: ${String(context.receiptSent)}`,
      );
    }
  } catch (error) {
    if (!shutdown.signal.aborted) throw error;
    console.log(`${event.id}: interrupted by shutdown, will be retried`);
    break;
  }
}

console.log(`Processed: ${[...processed].join(', ')}`);

/* Output:
evt_1: o_1 paid, receipt sent: true
evt_1: skipped
evt_2: skipped
evt_3: interrupted by shutdown, will be retried
Processed: evt_1
*/
