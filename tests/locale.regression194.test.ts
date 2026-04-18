import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getLocale } from "../src/app/state";
import { getString, initLocale } from "../src/shared/locale";
import { ensureZoteroLocaleFallbacks, ZOTERO_LOCALES } from "../scripts/zoteroLocaleFallbacks";

describe("Issue #194 localization regression guard", () => {
  type MockLocalizationInstance = {
    bundles: string[];
    isolated: boolean;
    formatMessagesSync: jest.Mock;
  };

  let localizationCtor: jest.Mock;
  const tempDirs: string[] = [];

  beforeEach(() => {
    (globalThis as any).addon.data.locale = undefined;

    localizationCtor = jest.fn().mockImplementation(function (this: MockLocalizationInstance, ...args: unknown[]) {
      const [bundles, isolated] = args as [string[], boolean];
      this.bundles = bundles;
      this.isolated = isolated;
      this.formatMessagesSync = jest.fn(() => []);
    });

    (globalThis as any).Localization = localizationCtor;
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("initLocale uses only addon-scoped FTL with isolated message lookup", () => {
    initLocale();

    expect(localizationCtor).toHaveBeenCalledTimes(1);
    expect(localizationCtor).toHaveBeenCalledWith(["zoplicate-addon.ftl"], true);

    const locale = getLocale();
    expect(locale).toBeDefined();
    expect(locale?.current.bundles).toEqual(["zoplicate-addon.ftl"]);
    expect(locale?.current.isolated).toBe(true);
  });

  test("getString always requests namespaced addon messages", () => {
    initLocale();
    const locale = getLocale();
    const formatMessagesSync = locale?.current.formatMessagesSync as jest.Mock;

    formatMessagesSync.mockReturnValueOnce([{ value: "Zoplicate" }]);

    const value = getString("addon-name");

    expect(value).toBe("Zoplicate");
    expect(formatMessagesSync).toHaveBeenCalledWith([{ id: "zoplicate-addon-name", args: undefined }]);

    const firstRequest = formatMessagesSync.mock.calls[0][0] as Array<{ id: string }>;
    const requestedID = firstRequest[0].id;
    expect(requestedID).toBe("zoplicate-addon-name");
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

  test("Zotero locale coverage includes Norwegian locales from the issue screenshots", () => {
    expect(ZOTERO_LOCALES).toEqual(expect.arrayContaining(["nb-NO", "nn-NO"]));
  });

  test("build adds empty addon FTL files for Zotero locales without translations", () => {
    const dist = mkdtempSync(join(tmpdir(), "zoplicate-194-"));
    tempDirs.push(dist);

    const enUSDir = join(dist, "addon", "locale", "en-US");
    const zhCNDir = join(dist, "addon", "locale", "zh-CN");
    mkdirSync(enUSDir, { recursive: true });
    mkdirSync(zhCNDir, { recursive: true });

    const fluentFiles = new Map([
      ["zoplicate-addon.ftl", "zoplicate-addon-name"],
      ["zoplicate-itemSection.ftl", "zoplicate-section-non-duplicate-header"],
      ["zoplicate-preferences.ftl", "zoplicate-pref-action-title"],
    ]);
    for (const [fileName, messageID] of fluentFiles) {
      writeFileSync(join(enUSDir, fileName), `${messageID} = English\n`, "utf-8");
      writeFileSync(join(zhCNDir, fileName), `${messageID} = Translated\n`, "utf-8");
    }

    const created = ensureZoteroLocaleFallbacks(dist, "zoplicate", ["en-US", "zh-CN", "nb-NO", "nn-NO"]);

    expect(created).toHaveLength(6);
    for (const locale of ["nb-NO", "nn-NO"]) {
      for (const fileName of fluentFiles.keys()) {
        const target = join(dist, "addon", "locale", locale, fileName);
        expect(existsSync(target)).toBe(true);
        expect(readFileSync(target, "utf-8")).toContain("keeps Zotero's native UI locale bundle complete");
      }
    }
    expect(readFileSync(join(zhCNDir, "zoplicate-addon.ftl"), "utf-8")).toBe("zoplicate-addon-name = Translated\n");
  });
});
