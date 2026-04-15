import { describe, expect, test, jest } from "@jest/globals";

const areDuplicatesMock = jest.fn<(...args: any[]) => Promise<boolean>>(async () => true);
jest.mock("../src/integrations/zotero/duplicateSearch", () => ({
  areDuplicates: areDuplicatesMock,
}));

const toggleNonDuplicatesMock = jest.fn<(...args: any[]) => Promise<void>>(async () => undefined);
jest.mock("../src/features/nonDuplicates/nonDuplicateActions", () => ({
  toggleNonDuplicates: toggleNonDuplicatesMock,
}));

jest.mock("../src/shared/locale", () => ({
  getString: jest.fn((key: string) => key),
}));

import { createDeferred, registerNonDuplicatesSection } from "../src/features/nonDuplicates/nonDuplicateSection";

const _Zotero = (globalThis as any).Zotero;
const _Components = (globalThis as any).Components;

function installItemPaneManager() {
  let sectionOptions: any;
  _Zotero.ItemPaneManager = {
    registerSection: jest.fn((options: any) => {
      sectionOptions = options;
      return "section-id";
    }),
    unregisterSection: jest.fn(),
  };
  return () => sectionOptions;
}

function makeWindow(overrides: Partial<Window> = {}) {
  return {
    closed: false,
    openDialog: jest.fn((_url: string, _name: string, _features: string, io: any) => {
      io.dataOut = [20];
      io.deferred.resolve();
    }),
    ...overrides,
  } as Window & { openDialog: jest.Mock };
}

function makeBody(win: Window) {
  return {
    ownerDocument: {
      defaultView: win,
    },
  } as HTMLDivElement;
}

function makeDb() {
  return {
    existsNonDuplicates: jest.fn(async () => false),
  } as any;
}

async function clickAddButton(options: { win?: Window; db?: any; item?: any } = {}) {
  const getSectionOptions = installItemPaneManager();
  const db = options.db ?? makeDb();
  registerNonDuplicatesSection(db);
  const onClick = getSectionOptions().sectionButtons[0].onClick;
  await onClick({
    body: makeBody(options.win ?? makeWindow()),
    item: options.item ?? { id: 10, libraryID: 1 },
  });
  return { db };
}

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

describe("non-duplicate section add button", () => {
  test("opens the item selection dialog from the section window", async () => {
    jest.clearAllMocks();
    const win = makeWindow();

    await clickAddButton({ win });

    expect(win.openDialog).toHaveBeenCalledWith(
      "chrome://zotero/content/selectItemsDialog.xhtml",
      "",
      "chrome,dialog=no,centerscreen,resizable=yes",
      expect.objectContaining({
        itemTreeID: "non-duplicate-box-select-item-dialog",
        filterLibraryIDs: [1],
      }),
    );
    expect(toggleNonDuplicatesMock).toHaveBeenCalledWith("mark", [20, 10], 1, { win });
  });

  test("does not open the dialog when the section window is closed", async () => {
    jest.clearAllMocks();
    const win = makeWindow({ closed: true });

    await clickAddButton({ win });

    expect(win.openDialog).not.toHaveBeenCalled();
    expect(toggleNonDuplicatesMock).not.toHaveBeenCalled();
  });

  test("continues data changes without a window when the section window closes after dialog selection", async () => {
    jest.clearAllMocks();
    const win = makeWindow({
      openDialog: jest.fn((_url: string, _name: string, _features: string, io: any) => {
        io.dataOut = [20];
        (win as any).closed = true;
        io.deferred.resolve();
      }) as any,
    });

    await clickAddButton({ win });

    expect(win.openDialog).toHaveBeenCalled();
    expect(toggleNonDuplicatesMock).toHaveBeenCalledWith("mark", [20, 10], 1, {});
  });

  test("does not open the dialog when the section window is a dead wrapper", async () => {
    jest.clearAllMocks();
    const win = makeWindow();
    _Components.utils.isDeadWrapper.mockReturnValueOnce(true);

    await clickAddButton({ win });

    expect(win.openDialog).not.toHaveBeenCalled();
    expect(toggleNonDuplicatesMock).not.toHaveBeenCalled();
  });
});
