/**
 * Global test setup: stubs for globalThis.Zotero, globalThis.ztoolkit, and globalThis.addon.
 * Loaded via jest.config.ts setupFiles before every test suite.
 */

import { jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// createMockItem factory
// ---------------------------------------------------------------------------

let _nextId = 1;

interface MockItemOverrides {
  id?: number;
  dateAdded?: string;
  dateModified?: string;
  itemTypeID?: number;
  usedFields?: string[];
  displayTitle?: string;
  json?: Record<string, unknown>;
  fields?: Record<string, string>;
  extraFields?: Record<string, string>;
  deleted?: boolean;
  numAttachments?: number;
}

/**
 * Build a Zotero.Item-shaped object with sensible defaults.
 * Every property can be overridden via the `overrides` argument.
 */
export function createMockItem(overrides: MockItemOverrides = {}): any {
  const id = overrides.id ?? _nextId++;
  const dateAdded = overrides.dateAdded ?? "2024-01-01 00:00:00";
  const dateModified = overrides.dateModified ?? "2024-01-01 00:00:00";
  const itemTypeID = overrides.itemTypeID ?? 1;
  const usedFields = overrides.usedFields ?? ["title"];
  const displayTitle = overrides.displayTitle ?? `Item ${id}`;
  const json = overrides.json ?? {};
  const fields = overrides.fields ?? {};
  const extraFields = overrides.extraFields ?? {};
  const deleted = overrides.deleted ?? false;
  const numAttachments = overrides.numAttachments ?? 1;

  const item: any = {
    id,
    dateAdded,
    dateModified,
    itemTypeID,
    deleted,
    getUsedFields: jest.fn((_asNames?: boolean) => usedFields),
    getDisplayTitle: jest.fn(() => displayTitle),
    toJSON: jest.fn(() => ({ ...json })),
    fromJSON: jest.fn((_obj: any) => {}),
    getField: jest.fn((field: string) => fields[field] ?? ""),
    getExtraField: jest.fn((field: string) => extraFields[field] ?? ""),
    numAttachments: jest.fn(() => numAttachments),
  };

  return item;
}

// ---------------------------------------------------------------------------
// globalThis.Zotero
// ---------------------------------------------------------------------------

(globalThis as any).Zotero = {
  Items: {
    get: jest.fn((input: any) => {
      if (Array.isArray(input)) {
        return input.map((id: number) => createMockItem({ id }));
      }
      return createMockItem({ id: input });
    }),
    getAsync: jest.fn(async (id: number) => createMockItem({ id })),
    getByLibraryAndKeyAsync: jest.fn(async (_libraryID: number, _key: string) => false),
    merge: jest.fn(async () => undefined),
  },
  Item: jest.fn().mockImplementation(function (this: any, ...args: any[]) {
    const itemType = args[0];
    this.id = _nextId++;
    this.itemType = itemType;
    this.parentItemID = undefined;
    this.libraryID = 1;
    this._note = "";
    this.setNote = jest.fn((content: string) => {
      this._note = content;
    });
    this.getNote = jest.fn(() => this._note);
    this.saveTx = jest.fn(async () => {});
    this.save = jest.fn(async () => {});
    return this;
  }),
  ItemFields: {
    getID: jest.fn((field: string) => {
      const ids: Record<string, number> = {
        title: 1,
        DOI: 2,
        ISBN: 3,
        publicationTitle: 4,
        volume: 5,
        issue: 6,
        pages: 7,
        abstractNote: 8,
        url: 9,
      };
      return ids[field] ?? 100;
    }),
    getName: jest.fn((id: number) => {
      const names: Record<number, string> = {
        1: "title",
        2: "DOI",
        3: "ISBN",
        4: "publicationTitle",
        5: "volume",
        6: "issue",
        7: "pages",
        8: "abstractNote",
        9: "url",
      };
      return names[id] ?? `field_${id}`;
    }),
    isValidForType: jest.fn((fieldID: number, itemTypeID: number) => {
      // By default: type 1 (journalArticle) supports volume(5), issue(6), pages(7), publicationTitle(4)
      // type 2 (preprint/document) does not support volume(5), issue(6), pages(7)
      if (itemTypeID === 2 && [4, 5, 6, 7].includes(fieldID)) {
        return false;
      }
      return true;
    }),
    getBaseIDFromTypeAndField: jest.fn(() => false),
    getFieldIDFromTypeAndBase: jest.fn(() => false),
    getLocalizedString: jest.fn((fieldID: number | string) =>
      fieldID === 5 || fieldID === "volume" ? "Volume" : `Field ${fieldID}`,
    ),
  },
  ItemTypes: {
    getID: jest.fn((type: string) => (type === "book" ? 3 : type === "preprint" ? 2 : 1)),
    getName: jest.fn((id: number) => (id === 3 ? "book" : id === 2 ? "preprint" : "journalArticle")),
  },
  CollectionTreeCache: {
    clear: jest.fn(),
  },
  Utilities: {
    cleanDOI: jest.fn((str: string) => {
      // Minimal DOI regex extraction matching Zotero behaviour
      const match = str.match(/10\.\d{4,9}\/[^\s]+/);
      return match ? match[0] : false;
    }),
    cleanISBN: jest.fn((str: string) => {
      return str ? str.replace(/[^0-9X]/gi, "") : "";
    }),
  },
  Prefs: {
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
  },
  Notifier: {
    registerObserver: jest.fn(() => "notifier-id"),
    unregisterObserver: jest.fn(),
  },
  Plugins: {
    addObserver: jest.fn(),
    removeObserver: jest.fn(),
  },
  getActiveZoteroPane: jest.fn(() => ({ selectItems: jest.fn() })),
  SyncedSettings: (() => {
    const store = new Map<string, any>();
    return {
      _store: store,
      get: jest.fn((libraryID: number, setting: string) => {
        const key = `${libraryID}/${setting}`;
        if (!store.has(key)) return null;
        // Return deep clone to match real Zotero behavior (JSON round-trip)
        return JSON.parse(JSON.stringify(store.get(key)));
      }),
      set: jest.fn(async (libraryID: number, setting: string, value: any) => {
        const key = `${libraryID}/${setting}`;
        store.set(key, JSON.parse(JSON.stringify(value)));
        return true;
      }),
      clear: jest.fn(async (libraryID: number, setting: string) => {
        const key = `${libraryID}/${setting}`;
        store.delete(key);
        return true;
      }),
      loadAll: jest.fn(async () => {}),
      onSyncDownload: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    };
  })(),
  Libraries: {
    getAll: jest.fn(() => [{ libraryID: 1, libraryType: "user" }]),
  },
  debug: jest.fn(),
};

// ---------------------------------------------------------------------------
// globalThis.ChromeUtils
// ---------------------------------------------------------------------------

(globalThis as any)._mergeItemsMock = jest.fn(async () => undefined);

(globalThis as any).ChromeUtils = {
  importESModule: jest.fn((path: string) => {
    if (path.includes("mergeItems")) {
      return { mergeItems: (globalThis as any)._mergeItemsMock };
    }
    return {};
  }),
};

(globalThis as any).__devItemIDColumn__ = false;

// ---------------------------------------------------------------------------
// globalThis.Components
// ---------------------------------------------------------------------------

(globalThis as any).Components = {
  utils: {
    isDeadWrapper: jest.fn(() => false),
  },
};

// ---------------------------------------------------------------------------
// globalThis.ztoolkit
// ---------------------------------------------------------------------------

(globalThis as any).ztoolkit = {
  log: jest.fn(),
};

// ---------------------------------------------------------------------------
// globalThis.addon
// ---------------------------------------------------------------------------

(globalThis as any).addon = {
  data: {
    alive: true,
    config: {
      addonName: "Zoplicate",
      addonID: "zoplicate@chenglongma.com",
      addonRef: "zoplicate",
      addonInstance: "Zoplicate",
      prefsPrefix: "extensions.zotero.zoplicate",
    },
    env: "development" as const,
    database: "SQLite" as const,
    ztoolkit: (globalThis as any).ztoolkit,
    dialogs: {},
    needResetDuplicateSearch: {} as Record<number, boolean>,
    duplicateSearchObj: {} as Record<number, any>,
    duplicateCounts: {} as Record<number, { total: number; unique: number }>,
    duplicateSets: {} as Record<number, any>,
    nonDuplicateSectionID: false as string | false,
    menuRegisteredIDs: [] as string[],
    processing: false,
  },
};
