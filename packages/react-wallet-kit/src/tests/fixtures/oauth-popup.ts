import { jest } from "@jest/globals";

export type OAuthPopupHandle = {
  readonly window: Window;
  readonly assignedUrls: string[];
  readonly close: jest.Mock;
  deliver(url: string): void;
};

export function installOAuthPopups() {
  const handles: OAuthPopupHandle[] = [];
  const open = jest.spyOn(window, "open").mockImplementation(() => {
    let href = "about:blank";
    let closed = false;
    const assignedUrls: string[] = [];
    const close = jest.fn(() => {
      closed = true;
    });
    const location = {
      get href() {
        return href;
      },
      set href(value: string) {
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
    });
    return popup;
  });

  return { handles, open };
}
