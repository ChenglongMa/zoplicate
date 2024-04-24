import { config } from "../../package.json";

function removeSiblings(targetElement: NonDocumentTypeChildNode) {
  let nextSibling = targetElement.nextElementSibling;
  while (nextSibling && !nextSibling.classList.contains(config.addonRef)) {
    const elementToRemove = nextSibling;
    nextSibling = nextSibling.nextElementSibling;
    elementToRemove.remove();
  }
}

function updateButtonAttribute(win: Window, attribute: string, value: { toString(): string }, ...ids: string[]) {
  ids.forEach((id) => {
    const button = win.document.getElementById(id);
    if (button) {
      button.setAttribute(attribute, value.toString());
    }
  });
}

function updateButtonDisabled(win: Window, disabled: boolean, ...ids: string[]) {
  updateButtonAttribute(win, "disabled", disabled, ...ids);
}

export { removeSiblings, updateButtonAttribute, updateButtonDisabled };
