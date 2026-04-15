import { describe, expect, test, beforeEach, jest } from "@jest/globals";
import { config } from "../package.json";
import { registerDevelopmentItemIDColumn } from "../src/integrations/zotero/devColumn";

const _Zotero = (globalThis as any).Zotero;

describe("registerDevelopmentItemIDColumn", () => {
  const registerColumnMock = jest.fn<(...args: any[]) => Promise<string | false>>(async () => "registered-item-id");
  const registerColumnsMock = jest.fn();
  const unregisterColumnMock = jest.fn<(...args: any[]) => Promise<boolean>>(async () => true);

  beforeEach(() => {
    jest.clearAllMocks();
    registerColumnMock.mockResolvedValue("registered-item-id");
    _Zotero.ItemTreeManager = {
      registerColumn: registerColumnMock,
      registerColumns: registerColumnsMock,
      unregisterColumn: unregisterColumnMock,
    };
  });

  test("does not register outside development", async () => {
    const disposer = await registerDevelopmentItemIDColumn("production");

    expect(registerColumnMock).not.toHaveBeenCalled();
    expect(registerColumnsMock).not.toHaveBeenCalled();

    await disposer();
    expect(unregisterColumnMock).not.toHaveBeenCalled();
  });

  test("registers with registerColumn and unregisters the returned dataKey", async () => {
    const disposer = await registerDevelopmentItemIDColumn("development");

    expect(registerColumnMock).toHaveBeenCalledTimes(1);
    expect(registerColumnsMock).not.toHaveBeenCalled();
    expect(registerColumnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginID: config.addonID,
        dataKey: "Item ID",
        label: "Item ID",
      }),
    );

    const options = registerColumnMock.mock.calls[0][0];
    expect(options.dataProvider({ id: 123, key: "ABCD" } as Zotero.Item)).toBe("123 ABCD");

    await disposer();
    expect(unregisterColumnMock).toHaveBeenCalledTimes(1);
    expect(unregisterColumnMock).toHaveBeenCalledWith("registered-item-id");
  });

  test("does not unregister when registration returns false", async () => {
    registerColumnMock.mockResolvedValue(false);

    const disposer = await registerDevelopmentItemIDColumn("development");
    await disposer();

    expect(unregisterColumnMock).not.toHaveBeenCalled();
  });
});
