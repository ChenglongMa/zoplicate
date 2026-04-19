declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ZoteroPane: _ZoteroTypes.ZoteroPane;
  Zotero_Tabs: typeof Zotero_Tabs;
  window: Window;
  document: Document;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<typeof import("../src/shared/ztoolkit").createZToolkit>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/app/addon").default;

declare const __env__: "production" | "development";
declare const __devItemIDColumn__: boolean;

declare class Localization {}

declare const ChromeUtils: {
  importESModule(path: string): any;
};

// ---------------------------------------------------------------------------
// Augment _ZoteroTypes.Items with getByLibraryAndKeyAsync
// ---------------------------------------------------------------------------

declare namespace _ZoteroTypes {
  interface Items {
    getByLibraryAndKeyAsync(
      libraryID: number,
      key: string,
    ): Promise<Zotero.Item | false>;
  }
}

// ---------------------------------------------------------------------------
// Zotero.MenuManager types (Zotero 9 pluginAPI)
// ---------------------------------------------------------------------------

declare namespace Zotero {
  interface MenuContext {
    menuElem: Element;
    setL10nArgs: (args: string) => void;
    setEnabled: (enabled: boolean) => void;
    setVisible: (visible: boolean) => void;
    setIcon: (icon: string, darkIcon?: string) => void;
    items?: Zotero.Item[];
    collectionTreeRow?: any;
    tabType?: string;
    tabSubType?: string;
    tabID?: string;
  }

  interface MenuData {
    menuType?: "menuitem" | "separator" | "submenu";
    l10nID?: string;
    l10nArgs?: string;
    icon?: string;
    darkIcon?: string;
    enableForTabTypes?: string[];
    onShowing?: (event: Event, context: MenuContext) => void;
    onShown?: (event: Event, context: MenuContext) => void;
    onHiding?: (event: Event, context: MenuContext) => void;
    onHidden?: (event: Event, context: MenuContext) => void;
    onCommand?: (event: Event, context: MenuContext) => void;
    menus?: MenuData[];
  }

  interface MenuOptions {
    menuID?: string;
    pluginID: string;
    target: string;
    menus: MenuData[];
  }

  const MenuManager: {
    registerMenu(options: MenuOptions): string | false;
    unregisterMenu(menuID: string): boolean;
  };

  // -------------------------------------------------------------------------
  // Zotero.SyncedSettings (synced key-value store)
  // -------------------------------------------------------------------------

  const SyncedSettings: {
    get(libraryID: number, setting: string): any;
    set(
      libraryID: number,
      setting: string,
      value: any,
      version?: number,
      synced?: boolean,
    ): Promise<boolean>;
    clear(
      libraryID: number,
      setting: string,
      options?: { skipDeleteLog?: boolean },
    ): Promise<boolean>;
    loadAll(libraryID: number): Promise<void>;
    onSyncDownload: {
      addListener(
        libraryID: number,
        setting: string,
        fn: (oldValue: any, newValue: any, conflict: boolean) => void | Promise<void>,
        bindTarget?: any,
      ): void;
    };
  };
}
