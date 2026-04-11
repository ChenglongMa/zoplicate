import { BasicTool, UITool, type BasicOptions } from "zotero-plugin-toolkit";

type MenuPopupTarget = XUL.MenuPopup | keyof typeof MENU_SELECTORS;
type InsertPosition = "before" | "after";
type MenuElement = XUL.MenuItem | XUL.Menu | XUL.MenuSeparator;

type DynamicMenuOptions<T extends MenuElement> = {
  isHidden?: (elem: T, ev: Event) => boolean | undefined;
  isDisabled?: (elem: T, ev: Event) => boolean | undefined;
  onShowing?: (elem: T, ev: Event) => unknown;
};

type MenuItemSpecificOptions =
  | ({
      tag: "menuitem";
      type?: "" | "checkbox" | "radio";
      checked?: boolean;
    } & DynamicMenuOptions<XUL.MenuItem>)
  | ({
      tag: "menu";
      popupId?: string;
      onpopupshowing?: string;
      children?: MenuItemOptions[];
    } & DynamicMenuOptions<XUL.Menu>)
  | ({
      tag: "menuseparator";
    } & DynamicMenuOptions<XUL.MenuSeparator>);

type MenuItemCommonOptions = {
  id?: string;
  label?: string;
  icon?: string;
  class?: string;
  classList?: string[];
  styles?: Record<string, string>;
  hidden?: boolean;
  disabled?: boolean;
  oncommand?: string;
  commandListener?: EventListenerOrEventListenerObject | ((event: Event) => unknown);
};

export type MenuItemOptions = MenuItemSpecificOptions & MenuItemCommonOptions;

const MENU_SELECTORS = {
  menuFile: "#menu_FilePopup",
  menuEdit: "#menu_EditPopup",
  menuView: "#menu_viewPopup",
  menuGo: "#menu_goPopup",
  menuTools: "#menu_ToolsPopup",
  menuHelp: "#menu_HelpPopup",
  collection: "#zotero-collectionmenu",
  item: "#zotero-itemmenu",
} as const;

export class LocalMenuRegistrar extends BasicTool {
  private readonly ui: UITool;
  private readonly elements = new Set<Element>();
  private readonly listenerCleanups: Array<() => void> = [];

  constructor(base?: BasicTool | BasicOptions) {
    super(base);
    this.ui = new UITool(this);
  }

  register(
    menuPopup: MenuPopupTarget,
    options: MenuItemOptions,
    insertPosition: InsertPosition = "after",
    anchorElement?: XUL.Element,
  ): false | undefined {
    const popup = this.resolveMenuPopup(menuPopup);
    if (!popup) {
      return false;
    }

    const menuElement = this.createMenuElement(popup.ownerDocument, popup, options);
    this.elements.add(menuElement);

    if (!popup.childElementCount) {
      popup.appendChild(menuElement);
      return;
    }

    const anchor = anchorElement ?? (insertPosition === "after" ? popup.lastElementChild : popup.firstElementChild);
    if (!anchor) {
      popup.appendChild(menuElement);
      return;
    }

    if (insertPosition === "after") {
      (anchor as Element).after(menuElement);
    } else {
      (anchor as Element).before(menuElement);
    }
  }

  unregister(menuId: string): void {
    const element = this.getGlobal("document").getElementById(menuId);
    element?.remove();
  }

  unregisterAll(): void {
    this.listenerCleanups.splice(0).forEach((cleanup) => cleanup());
    this.elements.forEach((element) => element.remove());
    this.elements.clear();
    this.ui.unregisterAll();
  }

  private resolveMenuPopup(menuPopup: MenuPopupTarget): XUL.MenuPopup | null {
    if (typeof menuPopup !== "string") {
      return menuPopup;
    }
    return this.getGlobal("document").querySelector(MENU_SELECTORS[menuPopup]) as XUL.MenuPopup | null;
  }

  private createMenuElement(doc: Document, popup: XUL.MenuPopup, options: MenuItemOptions): MenuElement {
    const element = this.ui.createElement(doc, options.tag, {
      namespace: "xul",
      id: options.id,
    }) as MenuElement;

    this.applyCommonOptions(element, options);
    this.registerDynamicOptions(popup, element, options);

    if (options.tag === "menuitem") {
      if (options.type) {
        element.setAttribute("type", options.type);
      }
      if (options.checked) {
        element.setAttribute("checked", "true");
      }
    }

    if (options.tag === "menu") {
      const subPopup = this.ui.createElement(doc, "menupopup", {
        namespace: "xul",
        id: options.popupId,
      }) as XUL.MenuPopup;

      if (options.onpopupshowing) {
        subPopup.setAttribute("onpopupshowing", options.onpopupshowing);
      }
      options.children?.forEach((child) => {
        subPopup.appendChild(this.createMenuElement(doc, subPopup, child));
      });
      element.appendChild(subPopup);
    }

    return element;
  }

  private applyCommonOptions(element: MenuElement, options: MenuItemOptions): void {
    if (options.label) {
      element.setAttribute("label", options.label);
    }
    if (options.hidden) {
      element.setAttribute("hidden", "true");
    }
    if (options.disabled) {
      element.setAttribute("disabled", "true");
    }
    if (options.oncommand) {
      element.setAttribute("oncommand", options.oncommand);
    }
    if (options.class) {
      options.class
        .split(/\s+/)
        .filter(Boolean)
        .forEach((className) => element.classList.add(className));
    }
    options.classList?.forEach((className) => element.classList.add(className));
    Object.entries(options.styles ?? {}).forEach(([property, value]) => {
      element.style.setProperty(property, value);
    });

    if (options.icon) {
      if (!this.getGlobal("Zotero").isMac) {
        element.classList.add(options.tag === "menu" ? "menu-iconic" : "menuitem-iconic");
      }
      element.style.setProperty("list-style-image", `url(${options.icon})`);
    }

    if (options.commandListener) {
      element.addEventListener("command", options.commandListener as EventListenerOrEventListenerObject);
    }
  }

  private registerDynamicOptions(popup: XUL.MenuPopup, element: MenuElement, options: MenuItemOptions): void {
    if (!options.isHidden && !options.isDisabled && !options.onShowing) {
      return;
    }

    const listener = (event: Event) => {
      if (options.isHidden) {
        const hidden = options.isHidden(element as never, event);
        if (typeof hidden !== "undefined") {
          element.toggleAttribute("hidden", hidden);
        }
      }
      if (options.isDisabled) {
        const disabled = options.isDisabled(element as never, event);
        if (typeof disabled !== "undefined") {
          element.toggleAttribute("disabled", disabled);
        }
      }
      options.onShowing?.(element as never, event);
    };

    popup.addEventListener("popupshowing", listener);
    this.listenerCleanups.push(() => popup.removeEventListener("popupshowing", listener));
  }
}
