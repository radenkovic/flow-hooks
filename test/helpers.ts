export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** A promise the test settles by hand, so ordering never depends on timers. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Resolves once `signal` aborts, with its reason. */
export function aborted(signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve(signal.reason);
    });
  });
}
