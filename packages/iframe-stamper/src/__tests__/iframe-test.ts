import { test, expect } from "@jest/globals";
import { IframeStamper } from "../index";

test("throws when instantiated outside of a browser environment", async function () {
  expect(() => {
    new IframeStamper({
      iframeUrl: "https://recovery.0xkey.com",
      iframeContainer: null,
      iframeElementId: "my-iframe-id",
    });
  }).toThrow("Cannot initialize iframe in non-browser environment");
});
