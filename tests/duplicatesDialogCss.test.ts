import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("duplicate dialog CSS", () => {
  const css = readFileSync(join(__dirname, "../addon/chrome/content/duplicatesDialog.css"), "utf-8");

  function block(selector: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!match) throw new Error(`Could not find CSS block for ${selector}`);
    return match[1];
  }

  test("keeps horizontal overflow hidden and title text wrapping", () => {
    expect(css).toContain("width: 860px");
    expect(css).toContain("overflow-x: hidden");
    expect(css).toContain("white-space: normal");
    expect(css).toContain("overflow-wrap: anywhere");
  });

  test("lets the dialog shrink to content instead of enforcing a minimum height", () => {
    expect(block("#zoplicate-duplicates-dialog-root")).not.toContain("min-height");
    expect(block(".zoplicate-duplicates-dialog")).not.toContain("min-height");
    expect(block(".du-table-shell")).not.toContain("min-height");
    expect(block("body")).not.toContain("height: 100%");
  });

  test("caps and scrolls only the duplicate table area", () => {
    expect(block(".du-table-shell")).toContain("max-height: 480px");
    expect(block(".du-table-scroll")).toContain("max-height: 480px");
    expect(block(".du-table-scroll")).toContain("overflow-y: auto");
    expect(block(".du-table-scroll")).toContain("overflow-x: hidden");
    expect(block(".du-table-scroll")).toContain("scrollbar-gutter: stable");
    expect(block('.du-table-scroll[data-overflowing="true"]')).toContain("overflow-y: scroll");
  });
});
