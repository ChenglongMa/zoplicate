import { describe, expect, test, jest } from "@jest/globals";
import { createDeferred } from "../src/features/nonDuplicates/nonDuplicateSection";

describe("createDeferred", () => {
  test("exposes a standard promise with resolve and reject functions", async () => {
    const deferred = createDeferred();
    const observer = jest.fn();

    expect(deferred.promise).toBeInstanceOf(Promise);
    expect(typeof deferred.resolve).toBe("function");
    expect(typeof deferred.reject).toBe("function");

    const completion = deferred.promise.then(observer);
    deferred.resolve();
    await completion;

    expect(observer).toHaveBeenCalledWith(undefined);
  });
});
