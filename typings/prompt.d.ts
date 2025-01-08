declare namespace Zotero {
  namespace Prompt {
    const BUTTON_TITLE_OK: number;
    const BUTTON_TITLE_CANCEL: number;
    const BUTTON_TITLE_YES: number;
    const BUTTON_TITLE_NO: number;
    const BUTTON_TITLE_SAVE: number;
    const BUTTON_TITLE_DONT_SAVE: number;
    const BUTTON_TITLE_REVERT: number;

    interface ConfirmOptions {
      window?: Window | null;
      title: string;
      text: string;
      button0?: string | number;
      button1?: string | number;
      button2?: string | number;
      checkLabel?: string;
      checkbox?: {};
      defaultButton?: number;
      buttonDelay?: boolean;
      delayButtons?: boolean;
    }

    /**
     * A wrapper around XPCOM's Services.prompt.confirmEx()
     * but with a friendlier interface.
     *
     * @param options - The options for the confirm dialog.
     * @returns The index of the button pressed.
     */
    function confirm(options: ConfirmOptions): number;
  }
}
