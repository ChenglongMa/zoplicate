import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vm from "node:vm";

const bootstrapSource = readFileSync(join(__dirname, "../addon/bootstrap.js"), "utf8");

function loadBootstrapContext() {
  const onShutdown = jest.fn(async () => undefined);
  const flushBundles = jest.fn();
  const unload = jest.fn();
  const destruct = jest.fn();
  const zotero = {
    __addonInstance__: {
      hooks: {
        onShutdown,
      },
    },
  };
  const context = {
    APP_SHUTDOWN: 2,
    ADDON_DISABLE: 4,
    Zotero: zotero,
    Components: {
      classes: {
        "@zotero.org/Zotero;1": {
          getService: jest.fn(() => ({ wrappedJSObject: zotero })),
        },
      },
      interfaces: {
        nsISupports: {},
        nsIStringBundleService: {},
      },
    },
    Cc: {
      "@mozilla.org/intl/stringbundle;1": {
        getService: jest.fn(() => ({ flushBundles })),
      },
    },
    Cu: {
      unload,
    },
  } as any;

  vm.createContext(context);
  vm.runInContext(bootstrapSource, context);
  context.chromeHandle = { destruct };

  return { context, destruct, flushBundles, onShutdown, unload };
}

describe("bootstrap shutdown lifecycle", () => {
  test("APP_SHUTDOWN runs addon teardown without unloading chrome resources", async () => {
    const { context, destruct, flushBundles, onShutdown, unload } = loadBootstrapContext();

    await context.shutdown({ rootURI: "jar:file:///zoplicate" }, context.APP_SHUTDOWN);

    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(flushBundles).not.toHaveBeenCalled();
    expect(unload).not.toHaveBeenCalled();
    expect(destruct).not.toHaveBeenCalled();
    expect(context.chromeHandle).toEqual({ destruct });
  });

  test("non-app shutdown preserves explicit unload cleanup", async () => {
    const { context, destruct, flushBundles, onShutdown, unload } = loadBootstrapContext();

    await context.shutdown({ rootURI: "jar:file:///zoplicate" }, context.ADDON_DISABLE);

    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(flushBundles).toHaveBeenCalledTimes(1);
    expect(unload).toHaveBeenCalledWith("jar:file:///zoplicate/chrome/content/scripts/__addonRef__.js");
    expect(destruct).toHaveBeenCalledTimes(1);
    expect(context.chromeHandle).toBeNull();
  });
});
