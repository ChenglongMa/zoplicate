import { isAlive } from "../../app/state";
import { type Disposer } from "../../app/lifecycle";

export type NotifyHandler = (
  event: string,
  type: string,
  ids: number[] | string[],
  extraData: Record<string, any>,
) => void | Promise<void>;

interface NotifyEvent {
  event: string;
  type: string;
  ids: number[] | string[];
  extraData: Record<string, any>;
}

export class NotifyDispatcher {
  private handlers = new Set<NotifyHandler>();
  private queue: NotifyEvent[] = [];
  private ready = false;

  registerHandler(handler: NotifyHandler): Disposer {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async dispatch(event: string, type: string, ids: number[] | string[], extraData: Record<string, any>): Promise<void> {
    if (!this.ready) {
      this.queue.push({ event, type, ids, extraData });
      return;
    }

    ztoolkit.log("notify", event, type, ids, extraData);
    await this.dispatchToHandlers(event, type, ids, extraData);
  }

  async setReady(ready: boolean): Promise<void> {
    this.ready = ready;
    if (!ready) {
      return;
    }

    while (this.queue.length > 0) {
      const { event, type, ids, extraData } = this.queue.shift()!;
      ztoolkit.log("notify shift", event, type, ids, extraData);
      await this.dispatchToHandlers(event, type, ids, extraData);
    }
  }

  reset(): void {
    this.ready = false;
    this.queue = [];
    this.handlers.clear();
  }

  private async dispatchToHandlers(
    event: string,
    type: string,
    ids: number[] | string[],
    extraData: Record<string, any>,
  ): Promise<void> {
    for (const handler of [...this.handlers]) {
      await handler(event, type, ids, extraData);
    }
  }
}

export const notifyDispatcher = new NotifyDispatcher();

/**
 * Register Zotero notifier observer.
 * Returns a Disposer that unregisters the observer.
 *
 * Note: This module does NOT import feature modules.
 * All feature-level dispatch is injected by app/hooks.ts (the composition root).
 */
export function registerNotifier(handler: NotifyHandler, options: { pluginID?: string } = {}): Disposer {
  const callback = {
    notify: async (event: string, type: string, ids: number[] | string[], extraData: { [key: string]: any }) => {
      if (!isAlive()) {
        return;
      }
      await handler(event, type, ids, extraData);
    },
  };

  // Register the callback in Zotero as an item observer
  const notifierID = Zotero.Notifier.registerObserver(callback, [
    "collection",
    "search",
    "share",
    "share-items",
    "item",
    "file",
    "collection-item",
    "item-tag",
    "tag",
    "setting",
    "group",
    "trash",
    "bucket",
    "relation",
    "sync",
    "api-key",
    "tab",
  ]);

  const pluginObserver: _ZoteroTypes.Plugins.observer = {
    shutdown: ({ id }: { id: string }) => {
      if (!options.pluginID || id === options.pluginID) {
        ztoolkit.log("plugin shutdown observed", id);
      }
    },
  };

  Zotero.Plugins?.addObserver?.(pluginObserver);

  return () => {
    Zotero.Notifier.unregisterObserver(notifierID);
    Zotero.Plugins?.removeObserver?.(pluginObserver);
  };
}
