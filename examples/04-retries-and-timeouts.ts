// Retries, timeouts and optional steps. None of these are built in: each is a
// small function that wraps a hook and returns a new hook. Copy what you need.
//
// Run it: npm run example examples/04-retries-and-timeouts.ts

import { setTimeout as sleep } from 'node:timers/promises';
import { flow, isCancelError, type Hook } from 'flow-hooks';

// --- Helpers ----------------------------------------------------------------

/** Runs `hook` again when it throws, up to `attempts` times in total. */
function retry<C extends object>(hook: Hook<C>, attempts = 3): Hook<C> {
  return async (ctx, api) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await hook(ctx, api);
      } catch (error) {
        // Never retry a cancel, an aborted flow, or the last attempt.
        if (isCancelError(error) || api.signal.aborted || attempt >= attempts) {
          throw error;
        }
      }
    }
  };
}

/** Gives `hook` its own deadline, on top of the flow's signal. */
function withTimeout<C extends object>(ms: number, hook: Hook<C>): Hook<C> {
  return (ctx, api) =>
    hook(ctx, {
      ...api,
      signal: AbortSignal.any([api.signal, AbortSignal.timeout(ms)]),
    });
}

/** If `hook` fails, log it and carry on with the context unchanged. */
function optional<C extends object>(name: string, hook: Hook<C>): Hook<C> {
  return async (ctx, api) => {
    try {
      return await hook(ctx, api);
    } catch (error) {
      if (isCancelError(error) || api.signal.aborted) throw error;
      console.log(`${name} failed, skipping it`);
      return undefined;
    }
  };
}

// --- Pretend services -------------------------------------------------------

let calls = 0;
async function fetchRate(): Promise<number> {
  await Promise.resolve();
  calls += 1;
  console.log(`fetchRate: attempt ${String(calls)}`);
  if (calls < 3) throw new Error('503 Service Unavailable');
  return 0.92;
}

async function fetchRecommendations(signal: AbortSignal): Promise<string[]> {
  await sleep(1_000, undefined, { signal }); // far too slow
  return ['Milk frother'];
}

// --- The flow ---------------------------------------------------------------

interface Quote {
  usd: number;
  rate?: number;
  eur?: number;
  recommendations?: string[];
}

const quote = await flow<Quote>(
  [
    // Flaky: fails twice, succeeds on the third try.
    retry(async (ctx) => ({ ...ctx, rate: await fetchRate() }), 3),

    (ctx) => ({ ...ctx, eur: Math.round(ctx.usd * (ctx.rate ?? 1)) }),

    // Nice to have: give it 50ms, and don't fail the flow if it's late.
    optional(
      'Recommendations',
      withTimeout(50, async (ctx, { signal }) => ({
        ...ctx,
        recommendations: await fetchRecommendations(signal),
      })),
    ),
  ],
  { usd: 100 },
);

console.log(
  `€${String(quote.eur)}, recommendations: ${String(quote.recommendations)}`,
);

// A deadline for the whole flow: pass a signal. Check `signal.aborted` to
// tell a timeout from other failures, whatever error the hook threw.
const deadline = AbortSignal.timeout(50);
try {
  await flow(
    [
      async (ctx, { signal }) => {
        await sleep(1_000, undefined, { signal });
        return ctx;
      },
    ],
    {},
    { signal: deadline },
  );
} catch (error) {
  if (!deadline.aborted) throw error;
  console.log('Whole flow: timed out after 50ms');
}

/* Output:
fetchRate: attempt 1
fetchRate: attempt 2
fetchRate: attempt 3
Recommendations failed, skipping it
€92, recommendations: undefined
Whole flow: timed out after 50ms
*/
