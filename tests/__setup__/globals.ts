/**
 * Global test setup: stubs for globalThis.Zotero, globalThis.ztoolkit, and globalThis.addon.
 * Loaded via jest.config.ts setupFiles before every test suite.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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

  const item: any = {
    id,
    dateAdded,
    dateModified,
    itemTypeID,
    getUsedFields: jest.fn((_asNames?: boolean) => usedFields),
    getDisplayTitle: jest.fn(() => displayTitle),
    toJSON: jest.fn(() => ({ ...json })),
    fromJSON: jest.fn((_obj: any) => {}),
    getField: jest.fn((field: string) => fields[field] ?? ""),
    getExtraField: jest.fn((field: string) => extraFields[field] ?? ""),
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
    merge: jest.fn(async () => undefined),
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
  },
  Prefs: {
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
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
    config: {
      addonRef: "zoplicate",
    },
    duplicateCounts: {} as Record<string, { total: number; unique: number }>,
  },
};
