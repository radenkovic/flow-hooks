import { isCancelError } from './cancel';
import { assertHooks, invoke, withSignal } from './internal';
import type { DefaultContext, Hook, HookApi, Immutable } from './types';

function branchApi(api: HookApi): { api: HookApi; abort: () => void } {
  const controller = new AbortController();
  return {
    api: withSignal(api, AbortSignal.any([api.signal, controller.signal])),
    abort: () => {
      controller.abort();
    },
  };
}

/**
 * Starts all hooks at once and continues with the first one to succeed.
 * The other hooks are signalled to stop through `api.signal`.
 *
 * A failing hook is ignored while another one can still succeed; if all of
 * them fail, the flow rejects with an `AggregateError`. A `cancel()` that
 * happens before a hook succeeds cancels the flow.
 *
 * Every hook receives the same context. The winning hook's return value
 * becomes the next context (`undefined` keeps the current one).
 */
export function any<C extends object = DefaultContext>(
  hooks: readonly Hook<C>[],
): Hook<C> {
  assertHooks(hooks, 'any()');
  if (hooks.length === 0) {
    throw new TypeError('any() expects at least one hook');
  }

  return async (ctx, parentApi) => {
    const { api, abort } = branchApi(parentApi);
    try {
      return await new Promise<Immutable<C>>((resolve, reject) => {
        const errors: unknown[] = [];
        let pending = hooks.length;
        hooks.forEach((hook, index) => {
          const label = `any() hook at index ${String(index)}`;
          invoke(hook, ctx, api, label).then(
            (next) => {
              resolve(next as Immutable<C>);
            },
            (error: unknown) => {
              if (isCancelError(error)) {
                reject(error);
                return;
              }
              errors[index] = error;
              pending -= 1;
              if (pending === 0) {
                reject(
                  new AggregateError(
                    errors,
                    'All hooks passed to any() failed',
                  ),
                );
              }
            },
          );
        });
      });
    } finally {
      abort();
    }
  };
}

/**
 * Starts all hooks at once and waits for all of them to succeed.
 *
 * If any hook throws or cancels, the others are signalled to stop through
 * `api.signal` and the flow rejects or cancels right away.
 *
 * Every hook receives the same context and returns its own next context
 * (or `undefined`). The changes are merged key by key: a key one hook adds,
 * changes or removes is applied, and if two hooks change the same key, the
 * later hook in the array wins.
 */
export function every<C extends object = DefaultContext>(
  hooks: readonly Hook<C>[],
): Hook<C> {
  assertHooks(hooks, 'every()');

  return async (ctx, parentApi) => {
    const { api, abort } = branchApi(parentApi);
    let results: object[];
    try {
      results = await Promise.all(
        hooks.map((hook, index) =>
          invoke(hook, ctx, api, `every() hook at index ${String(index)}`),
        ),
      );
    } catch (error) {
      abort();
      throw error;
    }
    return mergeChanges(ctx, results) as Immutable<C> | undefined;
  };
}

/** Applies each result's differences from `base`, in order. */
function mergeChanges(base: object, results: object[]): object | undefined {
  const before = base as Record<PropertyKey, unknown>;
  let merged: Record<PropertyKey, unknown> | undefined;
  for (const result of results) {
    if (result === base) continue;
    merged ??= { ...before };
    const after = result as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(after)) {
      if (!Object.hasOwn(before, key) || !Object.is(after[key], before[key])) {
        merged[key] = after[key];
      }
    }
    for (const key of Reflect.ownKeys(before)) {
      if (!Object.hasOwn(after, key)) Reflect.deleteProperty(merged, key);
    }
  }
  return merged;
}
