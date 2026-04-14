/**
 * Lifecycle utilities: Disposer, DisposerRegistry, patchMethod, compositeDisposer.
 *
 * These replace toolkit-level monkey patching and provide a structured way
 * to track and clean up resources (patches, listeners, observers) on
 * shutdown or window unload.
 */

// ---------------------------------------------------------------------------
// Disposer type
// ---------------------------------------------------------------------------

/** A function that cleans up a resource. May be sync or async. */
export type Disposer = () => void | Promise<void>;

// ---------------------------------------------------------------------------
// DisposerRegistry
// ---------------------------------------------------------------------------

/**
 * Collects disposers and runs them in LIFO (reverse) order on disposeAll().
 * Safe to call disposeAll() twice -- the second call is a no-op.
 */
export class DisposerRegistry {
  private disposers: Disposer[] = [];
  private disposed = false;

  /**
   * Register a disposer. Returns the same disposer for chaining.
   */
  add(disposer: Disposer): Disposer {
    this.disposers.push(disposer);
    return disposer;
  }

  /**
   * Run all disposers in LIFO order, awaiting any that return promises.
   * Safe to call multiple times -- second call is a no-op.
   */
  async disposeAll(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // LIFO: iterate in reverse; catch errors to ensure all disposers run
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try {
        await this.disposers[i]();
      } catch (e) {
        ztoolkit.log(`DisposerRegistry: disposer at index ${i} threw during disposeAll`, e);
      }
    }
    this.disposers.length = 0;
  }
}

// ---------------------------------------------------------------------------
// patchMethod
// ---------------------------------------------------------------------------

/**
 * Monkey-patch a method on a target object. Returns a Disposer that restores
 * the original method.
 *
 * If the method has been externally modified between patching and disposal,
 * the restore is skipped and a warning is logged via ztoolkit.log.
 *
 * @throws TypeError if target[funcSign] is not a function.
 */
export function patchMethod<T extends Record<string, any>>(
  target: T,
  funcSign: keyof T & string,
  patcher: (original: T[typeof funcSign]) => T[typeof funcSign],
): Disposer {
  const original = target[funcSign];

  if (typeof original !== "function") {
    throw new TypeError(
      `patchMethod: target.${funcSign} is not a function (got ${typeof original})`,
    );
  }

  const patched = patcher(original);
  target[funcSign] = patched;

  return () => {
    if (target[funcSign] === patched) {
      // Still our patch -- safe to restore
      target[funcSign] = original;
    } else {
      // Externally modified -- skip restore, log warning
      ztoolkit.log(
        `patchMethod: skipping restore of ${funcSign} -- target was externally modified`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// compositeDisposer
// ---------------------------------------------------------------------------

/**
 * Combine multiple disposers into one that calls them in LIFO order.
 */
export function compositeDisposer(...disposers: Disposer[]): Disposer {
  return async () => {
    for (let i = disposers.length - 1; i >= 0; i--) {
      try {
        await disposers[i]();
      } catch (e) {
        ztoolkit.log(`compositeDisposer: disposer at index ${i} threw during dispose`, e);
      }
    }
  };
}
