import type * as ReactTypes from "react";
import { Action } from "../../shared/prefs";

export const duplicateDialogActions = [Action.KEEP, Action.DISCARD, Action.CANCEL] as const;

export type DuplicateDialogAction = (typeof duplicateDialogActions)[number];

export interface DuplicateDialogRow {
  groupID: number;
  title: string;
  action: DuplicateDialogAction;
}

export interface DuplicateDialogStrings {
  header: string;
  titleColumn: string;
  asDefault: string;
  actions: Record<DuplicateDialogAction, string>;
}

export interface DuplicateDialogState {
  rows: DuplicateDialogRow[];
  savePreference: boolean;
  defaultAction: DuplicateDialogAction;
}

export interface DuplicateDialogProps extends DuplicateDialogState {
  version: number;
  strings: DuplicateDialogStrings;
  onStateChange: (state: DuplicateDialogState) => void;
}

export interface DuplicateDialogRenderer {
  render: (props: DuplicateDialogProps) => void;
  unmount: () => void;
}

export interface DuplicateDialogReactDOM {
  createRoot: (container: HTMLElement) => {
    render: (element: ReactTypes.ReactElement) => void;
    unmount: () => void;
  };
}

function normalizeDialogAction(action: Action): DuplicateDialogAction {
  return action === Action.ASK ? Action.CANCEL : (action as DuplicateDialogAction);
}

function getUniformAction(rows: DuplicateDialogRow[]): DuplicateDialogAction | undefined {
  if (rows.length === 0) return undefined;
  const firstAction = rows[0].action;
  return rows.every((row) => row.action === firstAction) ? firstAction : undefined;
}

function getNextAction(action: DuplicateDialogAction, direction: -1 | 1): DuplicateDialogAction {
  const index = duplicateDialogActions.indexOf(action);
  const nextIndex = (index + direction + duplicateDialogActions.length) % duplicateDialogActions.length;
  return duplicateDialogActions[nextIndex];
}

export function createDuplicatesDialogRenderer(
  React: typeof ReactTypes,
  ReactDOM: DuplicateDialogReactDOM,
  container: HTMLElement,
  initialProps: DuplicateDialogProps,
): DuplicateDialogRenderer {
  const root = ReactDOM.createRoot(container);

  function DuplicatesDialog(props: DuplicateDialogProps) {
    const [rows, setRows] = React.useState<DuplicateDialogRow[]>(props.rows);
    const [savePreference, setSavePreference] = React.useState(props.savePreference);
    const [defaultAction, setDefaultAction] = React.useState<DuplicateDialogAction>(props.defaultAction);
    const [tableOverflowing, setTableOverflowing] = React.useState(false);
    const tableScrollRef = React.useRef<HTMLDivElement | null>(null);

    const syncTableOverflow = React.useCallback(() => {
      const tableScroll = tableScrollRef.current;
      if (!tableScroll) {
        setTableOverflowing(false);
        return;
      }
      setTableOverflowing(tableScroll.scrollHeight > tableScroll.clientHeight + 1);
    }, []);

    const commitState = React.useCallback(
      (
        nextRows: DuplicateDialogRow[],
        options: Partial<Pick<DuplicateDialogState, "savePreference" | "defaultAction">> = {},
      ) => {
        const uniformAction = getUniformAction(nextRows);
        const nextSavePreference = uniformAction ? (options.savePreference ?? savePreference) : false;
        const nextDefaultAction = options.defaultAction ?? uniformAction ?? defaultAction;

        setRows(nextRows);
        setSavePreference(nextSavePreference);
        setDefaultAction(nextDefaultAction);
        props.onStateChange({
          rows: nextRows,
          savePreference: nextSavePreference,
          defaultAction: nextDefaultAction,
        });
      },
      [defaultAction, props, savePreference],
    );

    React.useEffect(() => {
      const normalizedRows = props.rows.map((row) => ({
        ...row,
        action: normalizeDialogAction(row.action),
      }));
      const uniformAction = getUniformAction(normalizedRows);
      const nextSavePreference = uniformAction ? props.savePreference : false;
      const nextDefaultAction = uniformAction ?? props.defaultAction;

      setRows(normalizedRows);
      setSavePreference(nextSavePreference);
      setDefaultAction(nextDefaultAction);
      props.onStateChange({
        rows: normalizedRows,
        savePreference: nextSavePreference,
        defaultAction: nextDefaultAction,
      });
    }, [props.version]);

    React.useLayoutEffect(() => {
      const tableScroll = tableScrollRef.current;
      const view = tableScroll?.ownerDocument.defaultView;

      syncTableOverflow();

      if (!tableScroll || !view) return undefined;

      const ResizeObserverCtor = view.ResizeObserver;
      const observer = ResizeObserverCtor ? new ResizeObserverCtor(syncTableOverflow) : undefined;
      observer?.observe(tableScroll);

      const table = tableScroll.querySelector(".du-table");
      if (table) observer?.observe(table);

      view.addEventListener("resize", syncTableOverflow);

      return () => {
        observer?.disconnect();
        view.removeEventListener("resize", syncTableOverflow);
      };
    }, [rows, syncTableOverflow]);

    const uniformAction = getUniformAction(rows);

    const selectRowAction = (groupID: number, action: DuplicateDialogAction) => {
      commitState(rows.map((row) => (row.groupID === groupID ? { ...row, action } : row)));
    };

    const selectAllAction = (action: DuplicateDialogAction) => {
      commitState(
        rows.map((row) => ({ ...row, action })),
        {
          defaultAction: action,
        },
      );
    };

    const setSavePreferenceValue = (value: boolean) => {
      commitState(rows, {
        savePreference: value,
        defaultAction: uniformAction ?? defaultAction,
      });
    };

    const handleChoiceKeyDown = (event: ReactTypes.KeyboardEvent<HTMLButtonElement>, row: DuplicateDialogRow) => {
      if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;

      event.preventDefault();
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const nextAction = getNextAction(row.action, direction);
      selectRowAction(row.groupID, nextAction);

      const group = event.currentTarget.closest("tr");
      setTimeout(() => {
        group?.querySelector<HTMLButtonElement>(`[data-action="${nextAction}"]`)?.focus();
      });
    };

    return (
      <section className="zoplicate-duplicates-dialog" aria-labelledby="zoplicate-duplicates-dialog-title">
        <h2 id="zoplicate-duplicates-dialog-title" className="du-dialog-title">
          {props.strings.header}
        </h2>
        <div className="du-table-shell" data-overflowing={tableOverflowing ? "true" : undefined}>
          <div
            className="du-table-scroll"
            data-overflowing={tableOverflowing ? "true" : undefined}
            ref={tableScrollRef}
          >
            <table className="du-table">
              <thead>
                <tr>
                  <th className="du-title-heading" scope="col">
                    {props.strings.titleColumn}
                  </th>
                  {duplicateDialogActions.map((action) => {
                    const selected = uniformAction === action;
                    return (
                      <th key={action} className="du-action-heading" scope="col">
                        <button
                          type="button"
                          className="du-select-all"
                          aria-pressed={selected}
                          onClick={() => selectAllAction(action)}
                        >
                          <span className="du-choice-marker" aria-hidden="true" />
                          <span>{props.strings.actions[action]}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.groupID}>
                    <td className="du-title-cell" title={row.title}>
                      {row.title}
                    </td>
                    {duplicateDialogActions.map((action) => {
                      const selected = row.action === action;
                      return (
                        <td key={action} className="du-action-cell">
                          <button
                            type="button"
                            className="du-choice"
                            role="radio"
                            aria-checked={selected}
                            aria-label={props.strings.actions[action]}
                            data-action={action}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => selectRowAction(row.groupID, action)}
                            onKeyDown={(event) => handleChoiceKeyDown(event, row)}
                          >
                            <span className="du-choice-marker" aria-hidden="true" />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <label className="du-default-option" hidden={!uniformAction}>
          <input
            type="checkbox"
            checked={savePreference}
            onChange={(event) => setSavePreferenceValue(event.currentTarget.checked)}
          />
          <span>{props.strings.asDefault}</span>
        </label>
      </section>
    );
  }

  const render = (props: DuplicateDialogProps) => {
    root.render(<DuplicatesDialog {...props} />);
  };

  render(initialProps);

  return {
    render,
    unmount: () => root.unmount(),
  };
}
