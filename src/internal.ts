import { isCancelError } from './cancel';
import type { Hook, HookApi, Immutable } from './types';

interface RunState {
  /** Context the flow was cancelled with, recorded by the innermost runner. */
  cancelledContext?: object;
}

const RUN_STATE: unique symbol = Symbol('flow-hooks.run');

type InternalApi = HookApi & { [RUN_STATE]?: RunState };

function attachState(api: HookApi, state: RunState): HookApi {
  // Non-enumerable, so the hidden state never shows up for users.
  return Object.defineProperty(api, RUN_STATE, { value: state });
}

/** Creates the API object for a new top-level run. */
export function createApi(signal: AbortSignal): HookApi {
  return attachState({ signal }, {});
}

/** Same run, different signal (used by `any()` / `every()` branches). */
export function withSignal(api: HookApi, signal: AbortSignal): HookApi {
  return attachState({ signal }, (api as InternalApi)[RUN_STATE] ?? {});
}

export function getCancelledContext(api: HookApi): object | undefined {
  return (api as InternalApi)[RUN_STATE]?.cancelledContext;
}

export function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function isFreezable(value: unknown): value is object {
  return Array.isArray(value) || isPlainObject(value);
}

/** Objects frozen by `deepFreeze()`, so later steps skip them in O(1). */
const deeplyFrozen: WeakSet<object> = new WeakSet();

/**
 * Freezes plain objects and arrays, recursively. Class instances (`Date`,
 * `Map`, a request object, ...) and functions are left untouched.
 */
export function deepFreeze<T>(value: T): T {
  if (!isFreezable(value) || deeplyFrozen.has(value)) return value;
  deeplyFrozen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

/**
 * Copies the plain objects and arrays in `value` so that freezing the copy
 * never freezes data the caller still owns. Shared and cyclic references are
 * preserved; already frozen contexts are reused as they are.
 */
function copyPlain<T>(value: T, seen: Map<object, unknown>): T {
  if (!isFreezable(value) || deeplyFrozen.has(value)) return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;
  const copy = (
    Array.isArray(value)
      ? []
      : Object.create(Object.getPrototypeOf(value) as object | null)
  ) as Record<PropertyKey, unknown>;
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable && 'value' in descriptor) {
      copy[key] = copyPlain(descriptor.value as unknown, seen);
    }
  }
  return copy as T;
}

/** Turns the caller's initial context into a frozen context the flow owns. */
export function initialContext(value: unknown): object {
  if (value === undefined) return deepFreeze({});
  if (!isPlainObject(value)) {
    throw new TypeError(
      `flow() expects the initial context to be a plain object, got ${describe(value)}`,
    );
  }
  return deepFreeze(copyPlain(value, new Map()));
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as {
      constructor?: { name?: string };
    };
    return `an instance of ${proto.constructor?.name ?? 'an unknown class'}`;
  }
  return typeof value;
}

/**
 * Validates a hook's return value: a plain object becomes the next (frozen)
 * context, `undefined` keeps the current one, anything else is a bug.
 */
export function nextContext(
  result: unknown,
  current: object,
  label: string,
): object {
  if (result === undefined) return current;
  if (isPlainObject(result)) return deepFreeze(result);
  throw new TypeError(
    `${label} must return a new context object or undefined, got ${describe(result)}`,
  );
}

export function assertHooks(hooks: unknown, caller: string): void {
  if (!Array.isArray(hooks)) {
    throw new TypeError(`${caller} expects an array of hooks`);
  }
  hooks.forEach((hook, index) => {
    if (typeof hook !== 'function') {
      throw new TypeError(
        `${caller} expects every hook to be a function, got ${typeof hook} at index ${String(index)}`,
      );
    }
  });
}

/** Calls a hook and validates its result; synchronous throws become rejections. */
export async function invoke<C extends object>(
  hook: Hook<C>,
  ctx: object,
  api: HookApi,
  label: string,
): Promise<object> {
  const result = await hook(ctx as Immutable<C>, api);
  return nextContext(result, ctx, label);
}

/** Runs hooks in sequence, each one receiving the context the previous returned. */
export async function runSequence<C extends object>(
  hooks: readonly Hook<C>[],
  initial: object,
  api: HookApi,
): Promise<object> {
  api.signal.throwIfAborted();
  let current = initial;
  for (const [index, hook] of hooks.entries()) {
    try {
      const next = await invoke(
        hook,
        current,
        api,
        `Hook at index ${String(index)}`,
      );
      api.signal.throwIfAborted();
      current = next;
    } catch (error) {
      const state = (api as InternalApi)[RUN_STATE];
      if (isCancelError(error) && state && !state.cancelledContext) {
        state.cancelledContext = current;
      }
      throw error;
    }
  }
  return current;
}
