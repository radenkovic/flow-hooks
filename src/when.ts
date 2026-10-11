import { assertHooks, runSequence } from './internal';
import type { Condition, DefaultContext, Hook, Immutable } from './types';

/**
 * Runs a hook, or a sequence of hooks, only when `condition` is truthy.
 * A `cancel()` inside the sequence stops the whole flow.
 */
export function when<C extends object = DefaultContext>(
  condition: Condition<C>,
  hooks: Hook<C> | readonly Hook<C>[],
): Hook<C> {
  if (typeof condition !== 'function') {
    throw new TypeError('when() expects a condition function');
  }
  if (Array.isArray(hooks)) {
    assertHooks(hooks, 'when()');
  } else if (typeof hooks !== 'function') {
    throw new TypeError('when() expects a hook or an array of hooks');
  }

  return async (ctx, api) => {
    if (!(await condition(ctx, api))) return undefined;
    if (Array.isArray(hooks)) {
      return (await runSequence(hooks, ctx, api)) as Immutable<C>;
    }
    return hooks(ctx, api);
  };
}
