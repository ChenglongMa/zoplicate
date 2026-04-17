import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { getLocale } from "../src/app/state";
import { getString, initLocale } from "../src/shared/locale";

describe("Issue #194 localization regression guard", () => {
  type MockLocalizationInstance = {
    bundles: string[];
    isolated: boolean;
    formatMessagesSync: jest.Mock;
  };

  let localizationCtor: jest.Mock;

  beforeEach(() => {
    (globalThis as any).addon.data.locale = undefined;

    localizationCtor = jest.fn().mockImplementation(function (this: MockLocalizationInstance, bundles: string[], isolated: boolean) {
      this.bundles = bundles;
      this.isolated = isolated;
      this.formatMessagesSync = jest.fn(() => []);
    });

    (globalThis as any).Localization = localizationCtor;
  });

  test("initLocale uses only addon-scoped FTL with isolated mode", () => {
    initLocale();

    expect(localizationCtor).toHaveBeenCalledTimes(1);
    expect(localizationCtor).toHaveBeenCalledWith(["zoplicate-addon.ftl"], true);

    const locale = getLocale();
    expect(locale).toBeDefined();
    expect(locale?.current.bundles).toEqual(["zoplicate-addon.ftl"]);
    expect(locale?.current.isolated).toBe(true);
  });

  test("getString requests only prefixed keys", () => {
    initLocale();
    const locale = getLocale();
    const formatMessagesSync = locale?.current.formatMessagesSync as jest.Mock;

    formatMessagesSync.mockReturnValueOnce([{ value: "Zoplicate" }]);

    const value = getString("addon-name");

    expect(value).toBe("Zoplicate");
    expect(formatMessagesSync).toHaveBeenCalledWith([{ id: "zoplicate-addon-name", args: undefined }]);

    const requestedID = formatMessagesSync.mock.calls[0][0][0].id;
    expect(requestedID.startsWith("zoplicate-")).toBe(true);
    expect(requestedID).not.toBe("zotero-attachments");
    expect(requestedID).not.toBe("zotero-tags");
  });

  test("getString fallback stays within addon namespace", () => {
    initLocale();
    const locale = getLocale();
    const formatMessagesSync = locale?.current.formatMessagesSync as jest.Mock;

    formatMessagesSync.mockReturnValueOnce([undefined]);

    expect(getString("does-not-exist")).toBe("zoplicate-does-not-exist");
  });

  test("getString branch lookup returns attribute when present", () => {
    initLocale();
    const locale = getLocale();
    const formatMessagesSync = locale?.current.formatMessagesSync as jest.Mock;

    formatMessagesSync.mockReturnValueOnce([
      {
        value: "Base",
        attributes: {
          label: "Branched",
        },
      },
    ]);

    expect(getString("menu-submenu-title", { branch: "label" })).toBe("Branched");
  });

  test("repeated initLocale calls stay controlled", () => {
    initLocale();
    initLocale();

    expect(localizationCtor).toHaveBeenCalledTimes(2);
  });
});
