import assert from "node:assert/strict";
import test from "node:test";

const { showBrowserNotification } = await import("./browser-notifications.ts");

test("builds the default browser environment from the globals it finds", async () => {
  const created = [];
  const originalNotification = globalThis.Notification;
  const hadServiceWorker = "serviceWorker" in globalThis.navigator;
  let registrationRequests = 0;

  class FakeNotification {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      this.onclick = null;
      this.closed = false;
      created.push(this);
    }

    close() {
      this.closed = true;
    }
  }

  globalThis.Notification = FakeNotification;
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    configurable: true,
    value: {
      async getRegistration() {
        registrationRequests += 1;
        return undefined;
      },
    },
  });

  const cleanup = () => {
    if (originalNotification === undefined) delete globalThis.Notification;
    else globalThis.Notification = originalNotification;
    if (!hadServiceWorker) delete globalThis.navigator.serviceWorker;
  };
  try {
    let clicked = 0;
    const delivery = await showBrowserNotification({
      title: "Session complete",
      body: "Task finished.",
      sessionUrl: "/?session=session-1",
      onClick: () => {
        clicked += 1;
      },
    });

    assert.equal(delivery, "window");
    assert.equal(registrationRequests, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].title, "Session complete");
    assert.deepEqual(created[0].options, { body: "Task finished." });

    created[0].onclick();
    assert.equal(created[0].closed, true);
    assert.equal(clicked, 1);
  } finally {
    cleanup();
  }
});
