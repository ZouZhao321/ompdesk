import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

before(() => {
  GlobalRegistrator.register({ url: "http://localhost:30141" });
});

after(async () => {
  await GlobalRegistrator.unregister();
});

const { copyText } = await import("./clipboard.ts");

const nativeNavigator = globalThis.navigator;

function useNavigator(navigator) {
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true, writable: true });
}

beforeEach(() => {
  useNavigator(nativeNavigator);
  delete document.execCommand;
});

test("writes through the async clipboard API when the browser provides one", async () => {
  const written = [];
  useNavigator({
    clipboard: {
      writeText: async (text) => {
        written.push(text);
      },
    },
  });

  await copyText("hello clipboard");

  assert.deepEqual(written, ["hello clipboard"]);
});

test("propagates clipboard API rejections", async () => {
  const failure = new Error("permission denied");
  useNavigator({
    clipboard: {
      writeText: async () => {
        throw failure;
      },
    },
  });

  await assert.rejects(copyText("boom"), (error) => error === failure);
});

test("falls back to a hidden textarea plus execCommand when the clipboard API is missing", async () => {
  useNavigator({});
  const created = [];
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tagName, options) => {
    const element = originalCreateElement(tagName, options);
    created.push(element);
    return element;
  };
  const commands = [];
  document.execCommand = (command) => {
    commands.push(command);
    return true;
  };

  try {
    await copyText("fallback text");
  } finally {
    document.createElement = originalCreateElement;
  }

  assert.deepEqual(commands, ["copy"]);
  assert.equal(created.length, 1);
  const textarea = created[0];
  assert.equal(textarea.tagName, "TEXTAREA");
  assert.equal(textarea.value, "fallback text");
  assert.equal(textarea.style.position, "fixed");
  assert.equal(textarea.style.opacity, "0");
  assert.equal(document.body.contains(textarea), false);
});

test("resolves even when execCommand reports failure", async () => {
  useNavigator({});
  document.execCommand = () => false;

  await copyText("still copied");
});

test("rejects when the DOM fallback throws", async () => {
  useNavigator({});
  document.execCommand = () => {
    throw new Error("execCommand unavailable");
  };

  await assert.rejects(copyText("nope"));
});
