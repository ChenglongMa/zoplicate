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
    } else {
      ztoolkit.log(`Element with id ${id} not found`);
    }
  });
}

function toggleButtonDisabled(win: Window, disabled: boolean, ...ids: string[]) {
  updateButtonAttribute(win, "disabled", disabled, ...ids);
}

function toggleButtonHidden(win: Window, hidden: boolean, ...ids: string[]) {
  updateButtonAttribute(win, "hidden", hidden, ...ids);
}

export { removeSiblings, updateButtonAttribute, toggleButtonDisabled, toggleButtonHidden };
