/**
 * @jest-environment jsdom
 */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import * as ReactDOM from "react-dom/client";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createDuplicatesDialogRenderer,
  type DuplicateDialogProps,
  type DuplicateDialogRenderer,
  type DuplicateDialogRow,
} from "../src/features/duplicates/duplicatesDialog";
import { Action } from "../src/shared/prefs";

const activeRenderers: DuplicateDialogRenderer[] = [];

function makeRows(rows: Array<Partial<DuplicateDialogRow> & Pick<DuplicateDialogRow, "groupID" | "title">>) {
  return rows.map((row) => ({
    action: Action.KEEP,
    ...row,
  })) as DuplicateDialogRow[];
}

function makeProps(overrides: Partial<DuplicateDialogProps> = {}): DuplicateDialogProps {
  return {
    rows: makeRows([
      { groupID: 1, title: "Alpha", action: Action.KEEP },
      { groupID: 2, title: "Beta", action: Action.DISCARD },
    ]),
    version: 1,
    savePreference: false,
    defaultAction: Action.CANCEL,
    strings: {
      header: "Duplicate items found",
      titleColumn: "Title",
      asDefault: "Use as default",
      actions: {
        [Action.KEEP]: "Keep new",
        [Action.DISCARD]: "Keep existing",
        [Action.CANCEL]: "Cancel",
      },
    },
    onStateChange: jest.fn(),
    ...overrides,
  };
}

async function renderDialog(props: DuplicateDialogProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let renderer: DuplicateDialogRenderer | undefined;

  await act(async () => {
    renderer = createDuplicatesDialogRenderer(React, ReactDOM, container, props);
  });
  activeRenderers.push(renderer!);

  return { container, renderer: renderer! };
}

function rowByTitle(title: string) {
  const cell = screen.getByText(title);
  const row = cell.closest("tr");
  if (!row) throw new Error(`Could not find row for ${title}`);
  return row as HTMLElement;
}

function defaultOption(container: HTMLElement) {
  const label = container.querySelector(".du-default-option");
  if (!label) throw new Error("Could not find default option label");
  return label as HTMLElement;
}

afterEach(async () => {
  await act(async () => {
    activeRenderers.splice(0).forEach((renderer) => renderer.unmount());
  });
  document.body.innerHTML = "";
});

describe("DuplicatesDialog React renderer", () => {
  test("renders initial rows with the selected row actions", async () => {
    await renderDialog(makeProps());

    expect(screen.getByRole("heading", { name: "Duplicate items found" })).toBeTruthy();
    expect(within(rowByTitle("Alpha")).getByRole("radio", { name: "Keep new" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      within(rowByTitle("Beta")).getByRole("radio", { name: "Keep existing" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("clicking a row action commits the updated row state", async () => {
    const onStateChange = jest.fn();
    await renderDialog(makeProps({ onStateChange }));
    onStateChange.mockClear();

    await userEvent.click(within(rowByTitle("Alpha")).getByRole("radio", { name: "Cancel" }));

    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          { groupID: 1, title: "Alpha", action: Action.CANCEL },
          { groupID: 2, title: "Beta", action: Action.DISCARD },
        ],
      }),
    );
    expect(within(rowByTitle("Alpha")).getByRole("radio", { name: "Cancel" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  test("clicking a column header applies one action to all rows", async () => {
    const onStateChange = jest.fn();
    await renderDialog(makeProps({ onStateChange }));
    onStateChange.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onStateChange).toHaveBeenLastCalledWith({
      rows: [
        { groupID: 1, title: "Alpha", action: Action.CANCEL },
        { groupID: 2, title: "Beta", action: Action.CANCEL },
      ],
      savePreference: false,
      defaultAction: Action.CANCEL,
    });
    expect(within(rowByTitle("Alpha")).getByRole("radio", { name: "Cancel" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(within(rowByTitle("Beta")).getByRole("radio", { name: "Cancel" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  test("save as default is visible only when all rows share the same action", async () => {
    const onStateChange = jest.fn();
    const { container } = await renderDialog(
      makeProps({
        rows: makeRows([
          { groupID: 1, title: "Alpha", action: Action.KEEP },
          { groupID: 2, title: "Beta", action: Action.KEEP },
        ]),
        savePreference: true,
        defaultAction: Action.KEEP,
        onStateChange,
      }),
    );
    onStateChange.mockClear();

    expect(defaultOption(container).hasAttribute("hidden")).toBe(false);
    expect((screen.getByLabelText("Use as default") as HTMLInputElement).checked).toBe(true);

    await userEvent.click(within(rowByTitle("Beta")).getByRole("radio", { name: "Cancel" }));

    expect(defaultOption(container).hasAttribute("hidden")).toBe(true);
    expect(onStateChange).toHaveBeenLastCalledWith({
      rows: [
        { groupID: 1, title: "Alpha", action: Action.KEEP },
        { groupID: 2, title: "Beta", action: Action.CANCEL },
      ],
      savePreference: false,
      defaultAction: Action.KEEP,
    });
  });

  test("arrow keys cycle a row choice and move focus to the selected radio", async () => {
    await renderDialog(
      makeProps({
        rows: makeRows([{ groupID: 1, title: "Alpha", action: Action.KEEP }]),
      }),
    );
    const row = rowByTitle("Alpha");
    const keepRadio = within(row).getByRole("radio", { name: "Keep new" });

    keepRadio.focus();
    await userEvent.keyboard("{ArrowRight}");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const keepExistingRadio = within(row).getByRole("radio", { name: "Keep existing" });
    expect(keepExistingRadio.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(keepExistingRadio);
  });

  test("a version change replaces rows and normalizes ASK to CANCEL", async () => {
    const onStateChange = jest.fn();
    const { renderer } = await renderDialog(makeProps({ onStateChange }));
    onStateChange.mockClear();

    await act(async () => {
      renderer.render(
        makeProps({
          rows: [
            {
              groupID: 99,
              title: "Gamma",
              action: Action.ASK as any,
            },
          ],
          version: 2,
          onStateChange,
        }),
      );
    });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(within(rowByTitle("Gamma")).getByRole("radio", { name: "Cancel" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(onStateChange).toHaveBeenLastCalledWith({
      rows: [{ groupID: 99, title: "Gamma", action: Action.CANCEL }],
      savePreference: false,
      defaultAction: Action.CANCEL,
    });
  });
});
