import { describe, expect, jest, test } from "@jest/globals";
import {
  getDuplicateDialogContentHeight,
  resizeDuplicateDialogToContent,
} from "../src/features/duplicates/duplicates";

function makeElement(scrollHeight: number, rectHeight = 0) {
  return {
    scrollHeight,
    getBoundingClientRect: jest.fn(() => ({ height: rectHeight })),
  };
}

function makeWindow(contentHeight: number, chromeHeight = 80, layoutHeight = 620, buttonRowHeight = 52) {
  const resizeTo = jest.fn();
  const body = makeElement(layoutHeight);
  const documentElement = makeElement(layoutHeight);
  const root = makeElement(layoutHeight);
  const dialogContent = makeElement(contentHeight);
  const buttonRow = makeElement(buttonRowHeight);
  const buttonWrapper = { parentElement: buttonRow };
  const button = { parentElement: buttonWrapper };

  return {
    closed: false,
    outerHeight: 700,
    innerHeight: 700 - chromeHeight,
    resizeTo,
    document: {
      body,
      documentElement,
      querySelector: jest.fn((selector: string) => (selector === ".zoplicate-duplicates-dialog" ? dialogContent : null)),
      getElementById: jest.fn((id: string) => {
        if (id === "zoplicate-duplicates-dialog-root") return root;
        if (id === "btn_process") return button;
        return null;
      }),
    },
  } as unknown as Window & { resizeTo: jest.Mock };
}

describe("duplicate dialog height resizing", () => {
  test("measures content height with window chrome compensation", () => {
    const win = makeWindow(240, 72);

    expect(getDuplicateDialogContentHeight(win)).toBe(364);
  });

  test("ignores root and body heights stretched by the initial dialog window", () => {
    const win = makeWindow(180, 72, 620, 48);

    expect(getDuplicateDialogContentHeight(win)).toBe(300);
  });

  test("requests smaller and larger window heights as content changes", () => {
    const compactWindow = makeWindow(240, 80);
    const overflowWindow = makeWindow(620, 80);

    expect(resizeDuplicateDialogToContent(compactWindow)).toBe(true);
    expect(resizeDuplicateDialogToContent(overflowWindow)).toBe(true);

    expect(compactWindow.resizeTo).toHaveBeenCalledWith(900, 372);
    expect(overflowWindow.resizeTo).toHaveBeenCalledWith(900, 752);
  });

  test("does not resize closed windows or windows without measurable content", () => {
    const closedWindow = makeWindow(240);
    Object.defineProperty(closedWindow, "closed", { value: true });
    const emptyWindow = makeWindow(0, 80, 0, 0);

    expect(resizeDuplicateDialogToContent(closedWindow)).toBe(false);
    expect(resizeDuplicateDialogToContent(emptyWindow)).toBe(false);
    expect(closedWindow.resizeTo).not.toHaveBeenCalled();
    expect(emptyWindow.resizeTo).not.toHaveBeenCalled();
  });

  test("reports resize failures through the error callback", () => {
    const error = new Error("resize blocked");
    const onError = jest.fn();
    const win = makeWindow(240);
    win.resizeTo.mockImplementation(() => {
      throw error;
    });

    expect(resizeDuplicateDialogToContent(win, { onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
