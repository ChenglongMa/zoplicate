import { describe, expect, beforeEach, test, jest } from "@jest/globals";

import { NotifyDispatcher, registerNotifier, type NotifyHandler } from "../src/integrations/zotero/notifier";

const _Zotero = globalThis.Zotero as any;

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as any).addon.data.alive = true;
});

describe("registerNotifier", () => {
  test("passes Zotero notify events to the injected handler", async () => {
    const handler = jest.fn<NotifyHandler>(async () => undefined);
    registerNotifier(handler);

    const callback = _Zotero.Notifier.registerObserver.mock.calls[0][0];
    await callback.notify("add", "item", [1], { refreshDuplicates: true });

    expect(handler).toHaveBeenCalledWith("add", "item", [1], { refreshDuplicates: true });
  });

  test("does not call handler after addon is no longer alive", async () => {
    const handler = jest.fn<NotifyHandler>(async () => undefined);
    registerNotifier(handler);

    (globalThis as any).addon.data.alive = false;
    const callback = _Zotero.Notifier.registerObserver.mock.calls[0][0];
    await callback.notify("add", "item", [1], {});

    expect(handler).not.toHaveBeenCalled();
  });

  test("disposer unregisters Zotero observer", () => {
    const disposer = registerNotifier(jest.fn<NotifyHandler>());
    const pluginObserver = _Zotero.Plugins.addObserver.mock.calls[0][0];

    disposer();

    expect(_Zotero.Notifier.unregisterObserver).toHaveBeenCalledWith("notifier-id");
    expect(_Zotero.Plugins.removeObserver).toHaveBeenCalledWith(pluginObserver);
  });

  test("registers a Zotero Plugins observer", () => {
    registerNotifier(jest.fn<NotifyHandler>(), { pluginID: "zoplicate@chenglongma.com" });

    expect(_Zotero.Plugins.addObserver).toHaveBeenCalledTimes(1);
    expect(_Zotero.Plugins.addObserver.mock.calls[0][0]).toHaveProperty("shutdown");
  });
});

describe("NotifyDispatcher", () => {
  test("queues events until ready and flushes them in order", async () => {
    const dispatcher = new NotifyDispatcher();
    const handler = jest.fn<NotifyHandler>(async () => undefined);
    dispatcher.registerHandler(handler);

    await dispatcher.dispatch("add", "item", [1], { first: true });
    await dispatcher.dispatch("delete", "item", [2], { second: true });

    expect(handler).not.toHaveBeenCalled();

    await dispatcher.setReady(true);

    expect(handler).toHaveBeenNthCalledWith(1, "add", "item", [1], { first: true });
    expect(handler).toHaveBeenNthCalledWith(2, "delete", "item", [2], { second: true });
  });

  test("handler disposer removes it from future dispatches", async () => {
    const dispatcher = new NotifyDispatcher();
    const handler = jest.fn<NotifyHandler>(async () => undefined);
    const disposer = dispatcher.registerHandler(handler);

    await dispatcher.setReady(true);
    disposer();
    await dispatcher.dispatch("add", "item", [1], {});

    expect(handler).not.toHaveBeenCalled();
  });

  test("reset clears queued events and handlers", async () => {
    const dispatcher = new NotifyDispatcher();
    const handler = jest.fn<NotifyHandler>(async () => undefined);
    dispatcher.registerHandler(handler);

    await dispatcher.dispatch("add", "item", [1], {});
    dispatcher.reset();
    await dispatcher.setReady(true);

    expect(handler).not.toHaveBeenCalled();
  });
});
