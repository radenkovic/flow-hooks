import { isCancelError } from './cancel';
import {
  assertHooks,
  createApi,
  getCancelledContext,
  initialContext as prepareInitial,
  runSequence,
} from './internal';
import type {
  DefaultContext,
  FlowOptions,
  FlowResult,
  Hook,
  Immutable,
} from './types';

/**
 * Runs hooks in order and reports whether the flow completed or was cancelled.
 * Rejects when a hook throws (other than `CancelError`) or the flow is aborted.
 */
export async function runFlow<C extends object = DefaultContext>(
  hooks: readonly Hook<C>[],
  initialContext?: NoInfer<Immutable<Partial<C>>>,
  options: FlowOptions = {},
): Promise<FlowResult<C>> {
  assertHooks(hooks, 'flow()');
  const initial = prepareInitial(initialContext);
  const api = createApi(options.signal ?? new AbortController().signal);
  try {
    const context = await runSequence(hooks, initial, api);
    return { context: context as Immutable<C>, cancelled: false };
  } catch (error) {
    if (!isCancelError(error)) throw error;
    // Every cancel passes through runSequence(), which records the context.
    return {
      context: getCancelledContext(api) as Immutable<C>,
      cancelled: true,
    };
  }
}

/**
 * Runs hooks in order and resolves with the final (frozen) context. A
 * cancelled flow resolves with the context at the moment it was cancelled;
 * use `runFlow()` to tell the two apart.
 */
export async function flow<C extends object = DefaultContext>(
  hooks: readonly Hook<C>[],
  initialContext?: NoInfer<Immutable<Partial<C>>>,
  options?: FlowOptions,
): Promise<Immutable<C>> {
  const { context } = await runFlow(hooks, initialContext, options);
  return context;
}
