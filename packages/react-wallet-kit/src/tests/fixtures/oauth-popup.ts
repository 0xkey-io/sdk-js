import { jest } from "@jest/globals";

export type OAuthPopupHandle = {
  readonly window: Window;
  readonly assignedUrls: string[];
  readonly close: jest.Mock;
  deliver(url: string): void;
  setClosed(closed?: boolean): void;
  failNextRead(error?: Error): void;
  failNextAssignment(error?: Error): void;
};

export function installOAuthPopups() {
  const handles: OAuthPopupHandle[] = [];
  let nextClosed = false;
  let nextReadError: Error | undefined;
  let nextAssignmentError: Error | undefined;
  const open = jest.spyOn(window, "open").mockImplementation(() => {
    let href = "about:blank";
    let closed = nextClosed;
    nextClosed = false;
    let readError = nextReadError;
    let assignmentError = nextAssignmentError;
    nextReadError = undefined;
    nextAssignmentError = undefined;
    const assignedUrls: string[] = [];
    const close = jest.fn(() => {
      closed = true;
    });
    const location = {
      get href() {
        if (readError) {
          const error = readError;
          readError = undefined;
          throw error;
        }
        return href;
      },
      set href(value: string) {
        if (assignmentError) {
          const error = assignmentError;
          assignmentError = undefined;
          throw error;
        }
        href = value;
        assignedUrls.push(value);
      },
    };
    const popup = {
      get closed() {
        return closed;
      },
      location,
      close,
    } as unknown as Window;
    handles.push({
      window: popup,
      assignedUrls,
      close,
      deliver(url: string) {
        href = url;
      },
      setClosed(value = true) {
        closed = value;
      },
      failNextRead(error = new DOMException("Blocked", "SecurityError")) {
        readError = error;
      },
      failNextAssignment(error = new Error("Synthetic assignment failure")) {
        assignmentError = error;
      },
    });
    return popup;
  });

  return {
    handles,
    open,
    setNextClosed(value = true) {
      nextClosed = value;
    },
    failNextRead(error = new DOMException("Blocked", "SecurityError")) {
      nextReadError = error;
    },
    failNextAssignment(error = new Error("Synthetic assignment failure")) {
      nextAssignmentError = error;
    },
  };
}
