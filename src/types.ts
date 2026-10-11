/**
 * Shape of the context when no explicit type is given. Hooks build the context
 * up step by step, so the default is deliberately loose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefaultContext = Record<string, any>;

type Primitive = string | number | bigint | boolean | symbol | null | undefined;

/** Values that are never frozen and keep their own (mutable) type. */
type Opaque =
  | Primitive
  | ((...args: never[]) => unknown)
  | Date
  | RegExp
  | Error
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Promise<unknown>
  | AbortSignal;

/**
 * Deeply readonly version of `T`, matching what flow-hooks freezes at runtime:
 * plain objects and arrays. Functions, class instances such as `Date` or
 * `Map`, and `any` are left as they are.
 */
export type Immutable<T> = 0 extends 1 & T
  ? T
  : T extends Opaque
    ? T
    : { readonly [K in keyof T]: Immutable<T[K]> };

/** Second argument passed to every hook. */
export interface HookApi {
  /**
   * Aborted when the flow is aborted through `FlowOptions.signal`, or when the
   * hook is a branch of `any()` / `every()` whose result is no longer needed.
   * Pass it to `fetch()` and other abortable APIs.
   */
  readonly signal: AbortSignal;
}

/** A new context, or `undefined` to keep the current one. */
export type HookResult<C extends object = DefaultContext> =
  Immutable<C> | undefined;

/**
 * A single step of a flow.
 *
 * Receives the current context, which is frozen, and returns the next one:
 * `(ctx) => ({ ...ctx, total: 42 })`. Returning `undefined` keeps the context
 * unchanged, which suits side-effect steps like logging.
 *
 * The context type is never inferred from return values, so a hook that adds
 * keys doesn't narrow the context type for the hooks before or after it.
 */
export type Hook<C extends object = DefaultContext> = (
  ctx: Immutable<C>,
  api: HookApi,
) => HookResult<NoInfer<C>> | Promise<HookResult<NoInfer<C>>>;

/** Predicate used by `when()`. A truthy (or resolved truthy) value runs the hooks. */
export type Condition<C extends object = DefaultContext> = (
  ctx: Immutable<C>,
  api: HookApi,
) => unknown;

export interface FlowOptions {
  /** Aborts the flow. The flow rejects with `signal.reason`. */
  signal?: AbortSignal;
}

export interface FlowResult<C extends object = DefaultContext> {
  /** The final context, or the context at the moment the flow was cancelled. */
  context: Immutable<C>;
  /** `true` when the flow was stopped by `cancel()` or a thrown `CancelError`. */
  cancelled: boolean;
}
