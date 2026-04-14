/**
 * Tests for src/app/lifecycle.ts: Disposer, DisposerRegistry, patchMethod, compositeDisposer.
 *
 * TDD: these tests are written before the implementation exists.
 */

import { jest, describe, it, expect } from "@jest/globals";

// The module under test -- does not exist yet (S01 expects failures).
import {
  type Disposer,
  DisposerRegistry,
  patchMethod,
  compositeDisposer,
} from "../src/app/lifecycle";

// ---------------------------------------------------------------------------
// 1. Disposer type contract
// ---------------------------------------------------------------------------

describe("Disposer type contract", () => {
  it("accepts a synchronous void function", () => {
    const disposer: Disposer = () => {};
    expect(typeof disposer).toBe("function");
  });

  it("accepts an async function returning Promise<void>", () => {
    const disposer: Disposer = async () => {};
    expect(typeof disposer).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 2. DisposerRegistry LIFO disposal order
// ---------------------------------------------------------------------------

describe("DisposerRegistry LIFO disposal order", () => {
  it("disposes in reverse (LIFO) order", async () => {
    const order: number[] = [];
    const registry = new DisposerRegistry();
    registry.add(() => { order.push(1); });
    registry.add(() => { order.push(2); });
    registry.add(() => { order.push(3); });

    await registry.disposeAll();

    expect(order).toEqual([3, 2, 1]);
  });
});

// ---------------------------------------------------------------------------
// 3. Async disposers
// ---------------------------------------------------------------------------

describe("DisposerRegistry async disposers", () => {
  it("awaits async disposers during disposeAll", async () => {
    let resolved = false;
    const registry = new DisposerRegistry();
    registry.add(async () => {
      await new Promise<void>((r) => setTimeout(r, 10));
      resolved = true;
    });

    await registry.disposeAll();
    expect(resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Double-dispose safety (no-op on second call)
// ---------------------------------------------------------------------------

describe("DisposerRegistry double-dispose safety", () => {
  it("is a no-op on second disposeAll call", async () => {
    let callCount = 0;
    const registry = new DisposerRegistry();
    registry.add(() => { callCount++; });

    await registry.disposeAll();
    await registry.disposeAll();

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. patchMethod restores original on dispose
// ---------------------------------------------------------------------------

describe("patchMethod restores original on dispose", () => {
  it("replaces method and restores on dispose", () => {
    const target = {
      greet(name: string) { return `hello ${name}`; },
    };
    const original = target.greet;

    const disposer = patchMethod(target, "greet", (orig) => {
      return function (this: any, name: string) {
        return orig.call(this, name) + "!";
      } as any;
    });

    expect(target.greet("world")).toBe("hello world!");
    disposer();
    expect(target.greet).toBe(original);
    expect(target.greet("world")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// 6. patchMethod skips restore and logs warning when target externally modified
// ---------------------------------------------------------------------------

describe("patchMethod external modification warning", () => {
  it("logs warning and skips restore when target was externally modified", () => {
    const target = {
      greet(name: string) { return `hello ${name}`; },
    };

    const disposer = patchMethod(target, "greet", (orig) => {
      return function (this: any, name: string) {
        return orig.call(this, name) + "!";
      } as any;
    });

    // Externally modify the method
    const externalReplacement = () => "external";
    target.greet = externalReplacement as any;

    disposer();

    // Should NOT have restored (external modification takes precedence)
    expect(target.greet).toBe(externalReplacement);
    // Should have logged a warning
    expect(ztoolkit.log).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. compositeDisposer combines multiple disposers
// ---------------------------------------------------------------------------

describe("compositeDisposer", () => {
  it("calls all disposers in LIFO order", async () => {
    const order: string[] = [];
    const d1: Disposer = () => { order.push("a"); };
    const d2: Disposer = () => { order.push("b"); };
    const d3: Disposer = () => { order.push("c"); };

    const combined = compositeDisposer(d1, d2, d3);
    await combined();

    expect(order).toEqual(["c", "b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// 8. DisposerRegistry.add returns the disposer for chaining
// ---------------------------------------------------------------------------

describe("DisposerRegistry.add returns disposer", () => {
  it("returns the same disposer that was passed in", () => {
    const registry = new DisposerRegistry();
    const disposer: Disposer = () => {};
    const returned = registry.add(disposer);
    expect(returned).toBe(disposer);
  });
});

// ---------------------------------------------------------------------------
// 9. Empty registry disposeAll is safe
// ---------------------------------------------------------------------------

describe("DisposerRegistry empty disposeAll", () => {
  it("does not throw on empty registry", async () => {
    const registry = new DisposerRegistry();
    await expect(registry.disposeAll()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 10. patchMethod throws TypeError when target property is not a function
// ---------------------------------------------------------------------------

describe("patchMethod TypeError on non-function", () => {
  it("throws TypeError when target property is not a function", () => {
    const target = { value: 42 } as any;
    expect(() => {
      patchMethod(target, "value", (orig) => orig);
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 11. DisposerRegistry error isolation: remaining disposers still run
// ---------------------------------------------------------------------------

describe("DisposerRegistry error isolation", () => {
  it("continues running remaining disposers when one throws", async () => {
    const order: number[] = [];
    const registry = new DisposerRegistry();
    registry.add(() => { order.push(1); });
    registry.add(() => { throw new Error("boom"); });
    registry.add(() => { order.push(3); });

    await registry.disposeAll();

    // 3 runs first (LIFO), then "boom" throws (caught), then 1 runs
    expect(order).toEqual([3, 1]);
    expect(ztoolkit.log).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 12. compositeDisposer error isolation
// ---------------------------------------------------------------------------

describe("compositeDisposer error isolation", () => {
  it("continues running remaining disposers when one throws", async () => {
    const order: string[] = [];
    const d1: Disposer = () => { order.push("a"); };
    const d2: Disposer = () => { throw new Error("fail"); };
    const d3: Disposer = () => { order.push("c"); };

    const combined = compositeDisposer(d1, d2, d3);
    await combined();

    // LIFO: c runs, then d2 throws (caught), then a runs
    expect(order).toEqual(["c", "a"]);
    expect(ztoolkit.log).toHaveBeenCalled();
  });
});
