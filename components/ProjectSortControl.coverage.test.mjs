import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

import { installDom, mount } from "../test-support/dom-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ProjectSortControl, sortMenuKeyAction, shouldDismissOnBlur } = await jiti.import("./ProjectSortControl.tsx");
const { AnimatedDropdown } = await jiti.import("./AnimatedDropdown.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { createElement } = await import("react");

function mountSort(props) {
  return mount(ProjectSortControl, props, I18nProvider);
}

test("sortMenuKeyAction wraps arrows and handles paging keys", () => {
  assert.deepEqual(sortMenuKeyAction("ArrowDown", -1, 2), { kind: "focus", index: 0 });
  assert.deepEqual(sortMenuKeyAction("ArrowDown", 1, 2), { kind: "focus", index: 0 });
  assert.deepEqual(sortMenuKeyAction("ArrowUp", 0, 2), { kind: "focus", index: 1 });
  assert.deepEqual(sortMenuKeyAction("ArrowUp", -1, 2), { kind: "focus", index: 1 });
  assert.deepEqual(sortMenuKeyAction("Home", 1, 2), { kind: "focus", index: 0 });
  assert.deepEqual(sortMenuKeyAction("End", 0, 2), { kind: "focus", index: 1 });
  assert.deepEqual(sortMenuKeyAction("Escape", 0, 2), { kind: "close" });
  assert.equal(sortMenuKeyAction("Tab", 0, 2), null);
  assert.equal(sortMenuKeyAction("ArrowDown", 0, 0), null);
});

test("shouldDismissOnBlur only dismisses when focus leaves an open control", () => {
  const outside = { id: "outside" };
  const sibling = { id: "sibling" };
  const inside = { contains: (node) => node === outside };

  assert.equal(shouldDismissOnBlur(false, inside, sibling), false);
  assert.equal(shouldDismissOnBlur(true, inside, null), false);
  assert.equal(shouldDismissOnBlur(true, null, sibling), false);
  assert.equal(shouldDismissOnBlur(true, inside, outside), false);
  assert.equal(shouldDismissOnBlur(true, inside, sibling), true);
});

test("trigger toggles the menu and shows both sort modes", async () => {
  const restore = installDom();
  try {
    let toggled = 0;
    const view = mountSort({
      mode: "time",
      open: false,
      onToggle: () => (toggled += 1),
      onDismiss: () => {},
      onSelectMode: () => {},
    });

    const trigger = view.container.querySelector('[aria-haspopup="menu"]');
    trigger.click();
    assert.equal(toggled, 1);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(view.container.querySelectorAll('[role="menuitemradio"]').length, 0);

    view.unmount();
  } finally {
    await restore();
  }
});

test("open menu renders both modes and selects through onSelectMode and onDismiss", async () => {
  const restore = installDom();
  try {
    const selected = [];
    let dismissed = 0;
    const view = mountSort({
      mode: "time",
      open: true,
      onToggle: () => {},
      onDismiss: () => (dismissed += 1),
      onSelectMode: (mode) => selected.push(mode),
    });

    const items = view.container.querySelectorAll('[role="menuitemradio"]');
    assert.equal(items.length, 2);
    items[1].click();
    assert.deepEqual(selected, ["name"]);
    assert.equal(dismissed, 1);

    view.unmount();
  } finally {
    await restore();
  }
});

test("escape inside the open menu dismisses it and returns focus to the trigger", async () => {
  const restore = installDom();
  try {
    let dismissed = 0;
    const view = mountSort({
      mode: "time",
      open: true,
      onToggle: () => {},
      onDismiss: () => (dismissed += 1),
      onSelectMode: () => {},
    });

    const wrapper = view.container.firstElementChild;
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(dismissed, 1);
    assert.equal(document.activeElement, view.container.querySelector('[aria-haspopup="menu"]'));

    view.unmount();
  } finally {
    await restore();
  }
});

test("arrow keys move focus between open menu items", async () => {
  const restore = installDom();
  try {
    const view = mountSort({
      mode: "time",
      open: true,
      onToggle: () => {},
      onDismiss: () => {},
      onSelectMode: () => {},
    });
    const wrapper = view.container.firstElementChild;
    const items = view.container.querySelectorAll('[role="menuitemradio"]');

    items[0].focus();
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(document.activeElement, items[1]);

    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(document.activeElement, items[0]);

    view.unmount();
  } finally {
    await restore();
  }
});

test("animated dropdown stays mounted while closing and then unmounts", async () => {
  const restore = installDom();
  try {
    const view = mount(
      AnimatedDropdown,
      { open: true, style: {}, children: createElement("span", null, "menu body") },
      I18nProvider,
    );
    assert.ok(view.container.textContent.includes("menu body"));

    view.rerender({ open: false, style: {}, children: createElement("span", null, "menu body") });
    assert.ok(view.container.textContent.includes("menu body"), "dropdown unmounted before its exit animation");

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(view.container.textContent, "");

    view.unmount();
  } finally {
    await restore();
  }
});
