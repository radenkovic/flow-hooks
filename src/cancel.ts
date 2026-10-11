import type { DefaultContext, Hook } from './types';

// Registered symbol, so `isCancelError()` also recognises errors created by a
// different copy of the package (e.g. the ESM and CJS builds loaded together).
const CANCEL_BRAND: unique symbol = Symbol.for('flow-hooks.cancel');

/**
 * Thrown to stop a flow without failing it. `flow()` resolves with the context
 * as it was when the error was thrown.
 */
export class CancelError extends Error {
  constructor(message = 'Flow cancelled') {
    super(message);
    this.name = 'CancelError';
  }
}

Object.defineProperty(CancelError.prototype, CANCEL_BRAND, { value: true });

export function isCancelError(error: unknown): error is CancelError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[CANCEL_BRAND] === true
  );
}

/**
 * Hook that stops the flow.
 *
 * Without an argument the flow resolves with the current context. With an
 * error, the flow rejects with that error instead.
 */
export function cancel<C extends object = DefaultContext>(
  error?: Error,
): Hook<C> {
  return () => {
    throw error === undefined ? new CancelError() : error;
  };
}
