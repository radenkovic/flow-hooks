// Stopping a flow early: cancel() to stop quietly, cancel(error) to fail.
// runFlow() tells you whether the flow finished or was cancelled.
//
// Run it: npm run example examples/02-stopping-early.ts

import { cancel, runFlow, when, type Hook } from 'flow-hooks';

// --- Pretend services -------------------------------------------------------

const existingUsers = new Set(['ada@example.com']);

async function createUser(email: string): Promise<{ id: string }> {
  await Promise.resolve(); // imagine a database insert
  return { id: `user_${email.split('@')[0] ?? ''}` };
}

// --- The flow ---------------------------------------------------------------

class ValidationError extends Error {}

interface SignUp {
  email: string;
  password: string;
  userId?: string;
}

const signUp: Hook<SignUp>[] = [
  // Invalid input: fail the flow with a specific error.
  when(
    (ctx) => !ctx.email.includes('@'),
    cancel(new ValidationError('Email is not valid')),
  ),
  when(
    (ctx) => ctx.password.length < 8,
    cancel(new ValidationError('Password is too short')),
  ),

  // Already registered: nothing to do, but it isn't an error either.
  when((ctx) => existingUsers.has(ctx.email), cancel()),

  async (ctx) => {
    const user = await createUser(ctx.email);
    return { ...ctx, userId: user.id };
  },
];

async function register(email: string, password: string): Promise<void> {
  try {
    const { context, cancelled } = await runFlow(signUp, { email, password });
    if (cancelled) {
      console.log(`${email}: already registered, skipped`);
    } else {
      console.log(`${email}: created ${String(context.userId)}`);
    }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    console.log(`${email}: rejected, ${error.message}`);
  }
}

await register('grace@example.com', 'correct horse');
await register('ada@example.com', 'correct horse');
await register('not-an-email', 'correct horse');
await register('linus@example.com', 'short');

/* Output:
grace@example.com: created user_grace
ada@example.com: already registered, skipped
not-an-email: rejected, Email is not valid
linus@example.com: rejected, Password is too short
*/
