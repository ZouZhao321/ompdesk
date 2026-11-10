/**
 * ChatInput 的交互覆盖：用 happy-dom 提供真实 DOM，React 通过 createRoot + flushSync
 * 同步渲染，事件直接派发到元素上，断言只看用户可见的结果（输入框值、渲染文本、
 * 按钮状态、回调参数）。
 *
 * React DOM 必须在 DOM 全局对象注册之后再加载：react-dom 在模块初始化时读取
 * canUseDOM / isInputEventSupported，先加载会退化到 IE polyfill 路径，onChange 不触发。
 *
 * React 的 setState 在事件里同步刷新，但 useEffect 走 passive 队列，flushSync 返回后
 * 仍可能没跑；辅助函数因此都先等一个宏任务再 flushSync，保证渲染结果已经落地。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:30141" });

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { flushSync } = await import("react-dom");
const { createJiti } = await import("jiti");

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { clearDraft, getDraft, setDraft } = await jiti.import("../lib/draft-store.ts");

const MODEL_LIST = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai" },
];

const SAMPLE_SKILLS = [{ name: "deploy", disableModelInvocation: true }];

/** 新用例的默认 props：组件要求的大部分回调都用空函数补齐。 */
function baseProps(overrides = {}) {
  return {
    onSend() {},
    onAbort() {},
    isStreaming: false,
    model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
    modelList: MODEL_LIST,
    onModelChange() {},
    ...overrides,
  };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** 等 passive effect 跑完，再把剩余渲染同步刷掉。 */
async function settle(ms = 5) {
  await tick(ms);
  flushSync(() => {});
}

function mount(props, { ref = null } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const element = (nextProps) =>
    React.createElement(I18nProvider, null, React.createElement(ChatInput, { ref, ...nextProps }));

  const render = (nextProps) => {
    flushSync(() => root.render(element(nextProps)));
  };
  render(props);

  return {
    container,
    ref,
    rerender: render,
    unmount() {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

/** 直接写 DOM 值（绕开 React 的 value tracker），再补上光标位置并派发 input 事件。 */
function setNativeValue(element, value) {
  let proto = Object.getPrototypeOf(element);
  let descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  while (!descriptor?.set && proto) {
    proto = Object.getPrototypeOf(proto);
    descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "value") : undefined;
  }
  descriptor.set.call(element, value);
}

async function type(element, text) {
  await typeAt(element, text, text.length);
}

/** 输入文本并把光标放在指定位置（用于 @ 引号形式的 drilling）。 */
async function typeAt(element, text, caret) {
  assert.ok(element, "expected an input to type into");
  setNativeValue(element, text);
  if (typeof element.setSelectionRange === "function") element.setSelectionRange(caret, caret);
  element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
  await settle();
}

async function click(element) {
  assert.ok(element, "expected element to click");
  element.click();
  await settle();
}

async function mouseDown(element) {
  assert.ok(element, "expected element to mouse down");
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
}

async function press(element, key, init = {}) {
  assert.ok(element, "expected element to press keys on");
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await settle();
  return event;
}

/** React 的 onMouseEnter/onMouseLeave 由 mouseover/mouseout 合成。 */
async function hover(element) {
  assert.ok(element, "expected element to hover");
  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  element.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  await settle();
}

/** 在 flushSync 里调用命令式方法，等 React 处理完更新。 */
async function apply(fn) {
  let result;
  flushSync(() => {
    result = fn();
  });
  await settle();
  return result;
}

const buttons = (root) => [...root.querySelectorAll("button")];
const byText = (root, text) => buttons(root).find((button) => button.textContent.trim() === text);
const byExactText = (root, text) => buttons(root).filter((button) => button.textContent.trim() === text);
const byTitle = (root, title) => buttons(root).find((button) => button.getAttribute("title") === title);
const byLabel = (root, label) => buttons(root).find((button) => button.getAttribute("aria-label") === label);
const containing = (root, text) => buttons(root).find((button) => button.textContent.includes(text));
const textareaOf = (root) => root.querySelector("textarea");
const previewOf = (root) => root.querySelector('img[alt=""]');

const pngFile = (name = "shot.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

async function attachImageThroughPicker(container) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [pngFile()], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(20);
  return input;
}

/** 记录并回应组件内部的 fetch；默认给一份可用的文件索引与技能列表。 */
function installFetch({ files = ["README.md", "src/app.ts", "src/lib/util.ts"], truncated = false } = {}) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/file-index")) {
      const query = new URL(url, "http://localhost").searchParams.get("q");
      if (query === null) return { ok: true, json: async () => ({ files, truncated }) };
      return { ok: true, json: async () => ({ matches: [{ path: "src/app.ts", isDir: false }] }) };
    }
    if (url.includes("/api/skills")) return { ok: true, json: async () => ({ skills: SAMPLE_SKILLS }) };
    return { ok: true, json: async () => ({}) };
  };
  globalThis.fetch.calls = calls;
  return () => {
    globalThis.fetch = previous;
  };
}

test.after(async () => {
  await settle(20);
  await GlobalRegistrator.unregister();
});

test("typing shows the text and enables the send button", async () => {
  const sent = [];
  const { container, unmount } = mount(baseProps({ onSend: (message) => sent.push(message) }));
  const textarea = textareaOf(container);
  const send = byText(container, "Send");

  assert.equal(send.disabled, true);
  await type(textarea, "review the diff");

  assert.equal(textarea.value, "review the diff");
  assert.equal(send.disabled, false);
  await click(send);

  assert.deepEqual(sent, ["review the diff"]);
  assert.equal(textarea.value, "");
  unmount();
});

test("ignores send for blank input and sends with Enter", async () => {
  const sent = [];
  const { container, unmount } = mount(baseProps({ onSend: (message) => sent.push(message) }));
  const textarea = textareaOf(container);

  await type(textarea, "   ");
  assert.equal(byText(container, "Send").disabled, true);
  await press(textarea, "Enter");
  assert.deepEqual(sent, []);

  await type(textarea, "hello");
  const enter = await press(textarea, "Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(sent, ["hello"]);

  await type(textarea, "not sent");
  await press(textarea, "Enter", { shiftKey: true });
  assert.deepEqual(sent, ["hello"]);
  unmount();
});

test("sends builtin slash commands through the builtin dispatcher", async () => {
  const sent = [];
  const builtins = [];
  const { container, unmount } = mount(
    baseProps({
      onSend: (message) => sent.push(message),
      onBuiltinCommand: async (message) => {
        builtins.push(message);
        if (message === "/name app") return { handled: true };
        if (message === "/reload") return { handled: true, prompt: "reload the tools" };
        if (message === "/session") return { handled: true, error: "no session" };
        return { handled: false };
      },
    }),
  );
  const textarea = textareaOf(container);

  await type(textarea, "/name app");
  await click(byText(container, "Send"));
  assert.deepEqual(builtins, ["/name app"]);
  assert.equal(textarea.value, "");
  assert.deepEqual(sent, []);

  await type(textarea, "/reload");
  await click(byText(container, "Send"));
  assert.deepEqual(sent, ["reload the tools"]);
  assert.equal(textarea.value, "");

  await type(textarea, "/session");
  await click(byText(container, "Send"));
  // 出错时保留输入，用户可以直接重试
  assert.equal(textarea.value, "/session");

  await type(textarea, "/unknown");
  await click(byText(container, "Send"));
  assert.deepEqual(sent, ["reload the tools", "/unknown"]);
  unmount();
});

test("opens the slash palette, filters it and completes a command", async () => {
  const loaded = [];
  const { container, unmount } = mount(
    baseProps({
      onLoadSlashCommands: async () => {
        loaded.push(1);
        return [{ name: "deploy", description: "Ship the app", source: "custom" }];
      },
    }),
  );
  const textarea = textareaOf(container);

  await type(textarea, "/");
  assert.ok(container.textContent.includes("/compact"));
  assert.equal(container.textContent.includes("/deploy"), false);
  assert.equal(loaded.length, 1);

  // 空查询下按字母序：第一项 compact，第二项 copy
  await press(textarea, "ArrowDown");
  await press(textarea, "Enter");
  assert.equal(textarea.value, "/copy ");
  assert.equal(container.textContent.includes("/compact"), false);

  await type(textarea, "/rew");
  assert.ok(container.textContent.includes("/rewind"));
  assert.equal(container.textContent.includes("/reload"), false);
  await mouseDown(containing(container, "/rewind"));
  assert.equal(textarea.value, "/rewind ");
  unmount();
});

test("closes the slash palette with Escape and reports an empty result", async () => {
  const { container, unmount } = mount(baseProps());
  const textarea = textareaOf(container);

  await type(textarea, "/");
  assert.ok(container.textContent.includes("/compact"));
  await press(textarea, "Escape");
  assert.equal(container.textContent.includes("/compact"), false);

  await type(textarea, "/zzzz");
  assert.equal(container.textContent.includes("/compact"), false);
  assert.ok(container.textContent.includes("No commands found"));

  await type(textarea, "/rewind");
  await press(textarea, "Tab");
  assert.equal(textarea.value, "/rewind ");
  unmount();
});

test("shows the loading state and hides builtin commands while the agent runs", async () => {
  const loading = mount(
    baseProps({
      slashCommandsLoading: true,
      slashCommands: [{ name: "deploy", description: "Ship the app", source: "custom" }],
    }),
  );

  await type(textareaOf(loading.container), "/");
  assert.ok(loading.container.textContent.includes("Loading commands..."));
  assert.equal(loading.container.textContent.includes("No commands found"), false);
  loading.unmount();

  const running = mount(
    baseProps({
      isStreaming: true,
      onSteer() {},
      slashCommands: [{ name: "deploy", description: "Ship the app", source: "custom" }],
    }),
  );
  await type(textareaOf(running.container), "/");
  assert.ok(running.container.textContent.includes("/deploy"));
  assert.equal(running.container.textContent.includes("/compact"), false);
  running.unmount();
});

test("adds an image through the file picker and removes it", async () => {
  const { container, unmount } = mount(baseProps());
  const input = await attachImageThroughPicker(container);

  const preview = previewOf(container);
  assert.ok(preview, "expected an image preview");
  assert.match(preview.getAttribute("src"), /^blob:/);
  assert.equal(input.value, "");

  const remove = buttons(container).find(
    (button) => !button.title && !button.textContent.trim() && button.closest("div")?.querySelector('img[alt=""]'),
  );
  await click(remove);
  assert.equal(previewOf(container), null);
  unmount();
});

test("the attach button opens the hidden file input", async () => {
  const { container, unmount } = mount(baseProps());
  const input = container.querySelector('input[type="file"]');
  let picked = 0;
  input.click = () => {
    picked += 1;
  };

  await click(byTitle(container, "Attach image"));
  assert.equal(picked, 1);
  unmount();
});

test("pasting an image attaches it, pasting text leaves the input alone", async () => {
  const { container, unmount } = mount(baseProps());
  const textarea = textareaOf(container);

  const textEvent = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(textEvent, "clipboardData", {
    value: { items: [{ type: "text/plain", getAsFile: () => null }] },
  });
  textarea.dispatchEvent(textEvent);
  await settle(20);
  assert.equal(textEvent.defaultPrevented, false);
  assert.equal(previewOf(container), null);

  const imageEvent = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(imageEvent, "clipboardData", {
    value: { items: [{ type: "image/png", getAsFile: () => pngFile("pasted.png") }] },
  });
  textarea.dispatchEvent(imageEvent);
  await settle(20);

  assert.equal(imageEvent.defaultPrevented, true);
  assert.ok(previewOf(container));
  unmount();
});

test("restores a stored draft and keeps typing in sync with it", async () => {
  const draftKey = "coverage-draft-restore";
  clearDraft(draftKey);
  setDraft(draftKey, { value: "restored draft", images: [{ data: "AQID", mimeType: "image/png" }] });

  const { container, unmount } = mount(baseProps({ draftKey }));
  const textarea = textareaOf(container);

  assert.equal(textarea.value, "restored draft");
  assert.equal(previewOf(container).getAttribute("src"), "data:image/png;base64,AQID");

  await type(textarea, "restored draft plus more");
  assert.equal(getDraft(draftKey).value, "restored draft plus more");

  await click(byText(container, "Send"));
  assert.equal(getDraft(draftKey), null);

  unmount();
  clearDraft(draftKey);
});

test("imperative handle inserts text, images and restores a message", async () => {
  const ref = React.createRef();
  const { container, unmount } = mount(baseProps(), { ref });
  const textarea = textareaOf(container);

  const focus = await apply(() => ref.current.focus());
  assert.equal(focus, undefined);
  assert.equal(document.activeElement, textarea);

  await apply(() => ref.current.insertIfEmpty("first prompt"));
  assert.equal(textarea.value, "first prompt");
  await apply(() => ref.current.insertIfEmpty("ignored"));
  assert.equal(textarea.value, "first prompt");

  await apply(() => ref.current.insertText("second prompt"));
  assert.equal(textarea.value, "first prompt second prompt");

  await type(textarea, "");
  await apply(() =>
    ref.current.replaceMessage({
      role: "user",
      content: [
        { type: "text", text: "first line" },
        { type: "text", text: "second line" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
      ],
    }),
  );
  assert.equal(textarea.value, "first line\nsecond line");
  assert.equal(previewOf(container).getAttribute("src"), "data:image/png;base64,AQID");

  const remove = buttons(container).find(
    (button) => !button.title && !button.textContent.trim() && button.closest("div")?.querySelector('img[alt=""]'),
  );
  await click(remove);
  assert.equal(previewOf(container), null);

  await type(textarea, "");
  await apply(() => ref.current.replaceMessage({ role: "user", content: "rewritten prompt" }));
  assert.equal(textarea.value, "rewritten prompt");
  assert.equal(previewOf(container), null);

  const restored = await apply(() =>
    ref.current.restoreSubmission("failed submission", [{ data: "AQID", mimeType: "image/png" }]),
  );
  assert.equal(restored, 0);
  assert.equal(textarea.value, "failed submission\n\nrewritten prompt");
  assert.ok(previewOf(container));
  assert.equal(await apply(() => ref.current.restoreSubmission("   ", [])), 0);

  await apply(() => ref.current.addImages([pngFile()]));
  await settle(20);
  assert.equal(previewOf(container) !== null, true);

  unmount();
});

test("reports the images that do not fit when restoring a submission", async () => {
  const ref = React.createRef();
  const { container, unmount } = mount(baseProps(), { ref });

  const images = Array.from({ length: 12 }, () => ({ data: "AQID", mimeType: "image/png" }));
  const dropped = await apply(() => ref.current.restoreSubmission("too many images", images));

  assert.equal(dropped, 2);
  assert.equal(container.querySelectorAll('img[alt=""]').length, 10);
  unmount();
});

test("rekeyDraft moves the composer draft to the new session key", async () => {
  const previousKey = "coverage-rekey-previous";
  const nextKey = "coverage-rekey-next";
  clearDraft(previousKey);
  clearDraft(nextKey);

  const ref = React.createRef();
  const { container, unmount } = mount(baseProps({ draftKey: previousKey }), { ref });
  await attachImageThroughPicker(container);
  await type(textareaOf(container), "queued while starting");

  await apply(() => ref.current.rekeyDraft(previousKey, nextKey));

  assert.equal(getDraft(previousKey), null);
  assert.equal(getDraft(nextKey).value, "queued while starting");
  assert.deepEqual(getDraft(nextKey).images, [{ data: "AQID", mimeType: "image/png" }]);
  assert.equal(textareaOf(container).value, "queued while starting");
  assert.equal(container.querySelectorAll('img[alt=""]').length, 1);

  unmount();
  clearDraft(nextKey);
});

test("selects a model from the dropdown and ignores the active one", async () => {
  const changes = [];
  const { container, unmount } = mount(baseProps({ onModelChange: (provider, id) => changes.push([provider, id]) }));

  await hover(byTitle(container, "Change model"));
  await click(byTitle(container, "Change model"));
  await click(byText(container, "Claude Sonnet 4.6"));
  assert.deepEqual(changes, [["anthropic", "claude-sonnet-4-6"]]);
  assert.equal(byText(container, "Claude Sonnet 4.6"), undefined);

  await click(byTitle(container, "Change model"));
  const activeOptions = byExactText(container, "DeepSeek V4 Flash");
  assert.equal(activeOptions.length, 2);
  await hover(activeOptions[activeOptions.length - 1]);
  await click(activeOptions[activeOptions.length - 1]);
  assert.deepEqual(changes, [["anthropic", "claude-sonnet-4-6"]]);
  unmount();
});

test("re-selects the active model when auto selection is on", async () => {
  const changes = [];
  const { container, unmount } = mount(
    baseProps({ isAutoModelSelection: true, onModelChange: (provider, id) => changes.push([provider, id]) }),
  );

  await click(byTitle(container, "Change model"));
  const activeOptions = byExactText(container, "DeepSeek V4 Flash");
  await click(activeOptions[activeOptions.length - 1]);
  assert.deepEqual(changes, [["deepseek", "deepseek-v4-flash"]]);
  unmount();
});

test("filters the model list and closes it on Escape or an outside click", async () => {
  const manyModels = Array.from({ length: 10 }, (_, index) => ({
    id: `model-${index}`,
    name: index === 0 ? "GPT-5.4" : `Model ${index}`,
    provider: index < 5 ? "openai" : "anthropic",
  }));
  const { container, unmount } = mount(baseProps({ model: null, modelList: manyModels, onModelChange() {} }));

  await click(byTitle(container, "Change model"));
  const filter = container.querySelector('input[aria-label="Filter models…"]');
  assert.ok(filter, "expected the filter input for a long model list");

  await type(filter, "gpt");
  assert.ok(byText(container, "GPT-5.4"));
  assert.equal(byText(container, "Model 3"), undefined);

  await type(filter, "zzz");
  assert.ok(container.textContent.includes("No matching models"));
  assert.ok(container.textContent.includes("Select model"));

  await type(filter, "gpt");
  await press(filter, "Escape");
  assert.equal(byText(container, "GPT-5.4"), undefined);

  await click(byTitle(container, "Change model"));
  assert.ok(byText(container, "GPT-5.4"));
  await mouseDown(document.body);
  assert.equal(byText(container, "GPT-5.4"), undefined);

  unmount();
});

test("switches a model role from the dropdown", async () => {
  const roles = [];
  const { container, unmount } = mount(
    baseProps({
      onRoleModelChange: (role) => roles.push(role),
      modelRoles: [
        {
          role: "default",
          name: "Everyday coding",
          tag: "DEF",
          resolved: { provider: "deepseek", modelId: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        },
        {
          role: "plan",
          name: "Planning",
          tag: "PLAN",
          resolved: { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
        },
      ],
    }),
  );

  await click(byTitle(container, "Change model"));
  assert.ok(container.textContent.includes("Roles"));
  assert.ok(container.textContent.includes("All models"));
  await hover(containing(container, "Planning"));
  await click(containing(container, "Planning"));

  assert.deepEqual(roles, ["plan"]);
  assert.equal(container.textContent.includes("All models"), false);
  unmount();
});

test("disables the model selector while streaming or switching", async () => {
  const streaming = mount(baseProps({ isStreaming: true }));
  const streamingButton = byTitle(streaming.container, "Change model");
  assert.equal(streamingButton.disabled, true);
  await click(streamingButton);
  assert.equal(streaming.container.textContent.includes("All models"), false);
  streaming.unmount();

  const switching = mount(baseProps({ modelSwitching: true }));
  const switchingButton = byTitle(switching.container, "Switching model");
  assert.equal(switchingButton.disabled, true);
  assert.equal(switchingButton.getAttribute("aria-busy"), "true");
  switching.unmount();
});

test("queues a steering message and a follow-up while the agent runs", async () => {
  const steers = [];
  const followUps = [];
  const { container, unmount } = mount(
    baseProps({
      isStreaming: true,
      onSteer: (message) => steers.push(message),
      onFollowUp: (message) => followUps.push(message),
    }),
  );
  const textarea = textareaOf(container);
  const steer = byTitle(container, "Interrupt the current run and inject this message now");
  const followUp = byTitle(container, "Queue this message after the agent finishes");

  assert.equal(steer.disabled, true);
  assert.equal(followUp.disabled, true);

  await type(textarea, "steer please");
  assert.equal(steer.disabled, false);
  await click(steer);
  assert.deepEqual(steers, ["steer please"]);
  assert.equal(textarea.value, "");

  await type(textarea, "later please");
  await click(followUp);
  assert.deepEqual(followUps, ["later please"]);

  await type(textarea, "enter steers");
  await press(textarea, "Enter");
  assert.deepEqual(steers, ["steer please", "enter steers"]);
  unmount();
});

test("Enter falls back to follow-up when no steer handler exists", async () => {
  const followUps = [];
  const { container, unmount } = mount(
    baseProps({ isStreaming: true, onFollowUp: (message) => followUps.push(message) }),
  );
  const textarea = textareaOf(container);

  assert.equal(byTitle(container, "Interrupt the current run and inject this message now"), undefined);
  await type(textarea, "queue me");
  await press(textarea, "Enter");
  assert.deepEqual(followUps, ["queue me"]);
  unmount();
});

test("routes rewind and slash commands to the builtin dispatcher while running", async () => {
  const builtins = [];
  const behavior = [];
  const steers = [];
  const { container, unmount } = mount(
    baseProps({
      isStreaming: true,
      onSteer: (message) => steers.push(message),
      onBuiltinCommand: async (message) => {
        builtins.push(message);
        return { handled: true, error: "Cannot rewind while the session is busy" };
      },
      onPromptWithStreamingBehavior: (message, mode) => behavior.push([message, mode]),
    }),
  );
  const textarea = textareaOf(container);

  await type(textarea, "/rewind");
  await press(textarea, "Enter");
  assert.deepEqual(builtins, ["/rewind"]);
  assert.deepEqual(steers, []);
  assert.equal(textarea.value, "");

  await type(textarea, "/model opus");
  await press(textarea, "Enter");
  assert.deepEqual(behavior, [["/model opus", "steer"]]);
  assert.equal(textarea.value, "");

  await type(textarea, "plain steer");
  await press(textarea, "Enter");
  assert.deepEqual(steers, ["plain steer"]);
  unmount();
});

test("Stop aborts the running agent and Escape does the same", async () => {
  let aborts = 0;
  const { container, unmount } = mount(baseProps({ isStreaming: true, onAbort: () => (aborts += 1) }));
  const textarea = textareaOf(container);

  await click(byText(container, "Stop"));
  assert.equal(aborts, 1);

  await press(textarea, "Escape");
  assert.equal(aborts, 2);
  unmount();
});

test("navigates the history menu with the keyboard", async () => {
  const { container, unmount } = mount(baseProps({ inputHistory: ["first prompt", "second prompt"] }));
  const textarea = textareaOf(container);

  const up = await press(textarea, "ArrowUp");
  assert.equal(up.defaultPrevented, true);
  assert.ok(container.textContent.includes("first prompt"));
  assert.ok(container.textContent.includes("second prompt"));

  // ArrowUp 从最后一条开始，ArrowDown 到底后停在最后一条
  await mouseDown(containing(container, "first prompt"));
  assert.equal(textarea.value, "first prompt");
  assert.equal(container.textContent.includes("second prompt"), false);

  await type(textarea, "");
  await press(textarea, "ArrowUp");
  assert.ok(container.textContent.includes("second prompt"));
  await press(textarea, "ArrowDown");
  await press(textarea, "ArrowUp");
  assert.ok(container.textContent.includes("first prompt"));
  await press(textarea, "Escape");
  assert.equal(container.textContent.includes("first prompt"), false);

  await press(textarea, "ArrowUp");
  await press(textarea, "Tab");
  assert.equal(textarea.value, "second prompt");

  await type(textarea, "");
  await press(textarea, "ArrowUp");
  await press(textarea, "Enter");
  assert.equal(textarea.value, "second prompt");
  unmount();
});

test("opens the @ file menu, completes a path and closes on Escape", async () => {
  const restoreFetch = installFetch();
  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await type(textarea, "@");
    await settle(20);

    assert.ok(globalThis.fetch.calls.some((url) => url.startsWith("/api/file-index?cwd=%2Ftmp%2Fproject")));
    assert.ok(container.textContent.includes("README.md"));
    assert.ok(container.textContent.includes("app.ts"));

    await press(textarea, "ArrowDown");
    await mouseDown(containing(container, "README.md"));
    assert.equal(textarea.value, "@README.md ");

    await type(textarea, "@RE");
    await settle(20);
    assert.ok(container.textContent.includes("README.md"));

    await press(textarea, "Escape");
    assert.equal(container.textContent.includes("README.md"), false);

    await type(textarea, "@");
    await settle(20);
    assert.ok(container.textContent.includes("README.md"));

    // 光标移动重新定位 @ 查询
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
    await settle(20);
    assert.ok(container.textContent.includes("README.md"));
    unmount();
  } finally {
    restoreFetch();
  }
});

test("completes an @ path with Tab and keeps the token open for directories", async () => {
  const restoreFetch = installFetch({ files: ["src/app.ts", "src/lib/util.ts"] });
  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await type(textarea, "@app");
    await settle(20);
    assert.ok(container.textContent.includes("app.ts"));
    await press(textarea, "Tab");
    assert.equal(textarea.value, "@src/app.ts ");

    await type(textarea, "@src/");
    await settle(20);
    assert.ok(container.textContent.includes("lib"));
    await mouseDown(containing(container, "lib"));
    assert.equal(textarea.value, "@src/lib/");
    unmount();
  } finally {
    restoreFetch();
  }
});

test("asks the server for deep files when the index is truncated", async () => {
  const restoreFetch = installFetch({ files: ["src/app.ts"], truncated: true });
  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await type(textarea, "@");
    await settle(20);
    assert.ok(container.textContent.includes("index truncated"));

    await type(textarea, "@deep");
    await settle(220);
    assert.ok(globalThis.fetch.calls.some((url) => url.includes("q=deep")));
    assert.ok(container.textContent.includes("app.ts"));
    unmount();
  } finally {
    restoreFetch();
  }
});

test("shows an empty @ result instead of a stale match list", async () => {
  const restoreFetch = installFetch({ files: [] });
  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await type(textarea, "@missing");
    await settle(20);
    assert.ok(container.textContent.includes("No matching files"));
    unmount();
  } finally {
    restoreFetch();
  }
});

test("changes the reasoning level from the thinking dropdown", async () => {
  const levels = [];
  const { container, unmount } = mount(
    baseProps({
      thinkingLevel: "high",
      onThinkingLevelChange: (level) => levels.push(level),
      availableThinkingLevels: ["low", "high"],
      thinkingLevelMap: { high: "high effort" },
    }),
  );

  const trigger = byLabel(container, "Change reasoning level");
  assert.equal(trigger.getAttribute("title"), "Change reasoning level: high effort");
  await hover(trigger);
  await click(trigger);

  assert.ok(containing(container, "Automatically select reasoning effort"));
  assert.equal(containing(container, "Minimal reasoning"), undefined);

  const active = containing(container, "high effort");
  assert.ok(active);
  await hover(active);

  const low = containing(container, "Low reasoning");
  await hover(low);
  await click(low);
  assert.deepEqual(levels, ["low"]);
  assert.equal(containing(container, "Low reasoning"), undefined);
  unmount();
});

test("changes the tool preset from its dropdown", async () => {
  const presets = [];
  const { container, unmount } = mount(
    baseProps({ toolPreset: "default", onToolPresetChange: (preset) => presets.push(preset) }),
  );

  const trigger = byLabel(container, "Change tool preset");
  assert.equal(trigger.getAttribute("title"), "Change tool preset: default");
  await hover(trigger);
  await click(trigger);
  assert.ok(container.textContent.includes("No tools, read-only"));

  await hover(containing(container, "full"));
  await click(containing(container, "full"));
  assert.deepEqual(presets, ["full"]);

  await click(byLabel(container, "Change tool preset"));
  await hover(containing(container, "off"));
  await click(containing(container, "off"));
  assert.deepEqual(presets, ["full", "none"]);
  unmount();
});

test("does not re-apply the active tool preset", async () => {
  const presets = [];
  const { container, unmount } = mount(
    baseProps({ toolPreset: "default", onToolPresetChange: (preset) => presets.push(preset) }),
  );

  await click(byLabel(container, "Change tool preset"));
  await hover(containing(container, "default"));
  await click(containing(container, "default"));
  assert.deepEqual(presets, []);
  assert.equal(container.textContent.includes("No tools, read-only"), false);
  unmount();
});

test("compacts context, stops a compaction and toggles the completion sound", async () => {
  let compactions = 0;
  let aborts = 0;
  let toggles = 0;
  const { container, unmount } = mount(
    baseProps({
      soundEnabled: true,
      onCompact: () => (compactions += 1),
      onAbortCompaction: () => (aborts += 1),
      onSoundToggle: () => (toggles += 1),
    }),
  );

  const compact = byTitle(container, "Compact context");
  await hover(compact);
  await click(compact);
  assert.equal(compactions, 1);

  const sound = byLabel(container, "Disable completion sound");
  await hover(sound);
  await click(sound);
  assert.equal(toggles, 1);
  unmount();

  const compacting = mount(
    baseProps({
      isCompacting: true,
      onCompact: () => (compactions += 1),
      onAbortCompaction: () => (aborts += 1),
    }),
  );
  const stop = byTitle(compacting.container, "Stop compaction");
  await hover(stop);
  await click(stop);
  assert.equal(aborts, 1);
  assert.equal(compactions, 1);
  compacting.unmount();
});

test("renders retry, compaction and queued message banners with actions", async () => {
  let recalls = 0;
  const { container, unmount } = mount(
    baseProps({
      retryInfo: { attempt: 2, maxAttempts: 3, errorMessage: "rate limited" },
      compactResult: { reason: "manual", tokensBefore: 12_000, estimatedTokensAfter: 4_000 },
      queuedMessages: { steering: ["steer text"], followUp: ["[Image]"] },
      onRecallQueue: () => (recalls += 1),
      contextUsage: { tokens: 100_000, contextWindow: 128_000, percent: 78 },
    }),
  );

  assert.ok(container.textContent.includes("Retrying (2/3)…"));
  assert.ok(container.textContent.includes("rate limited"));
  assert.ok(container.textContent.includes("12k -> 4k"));
  assert.ok(container.textContent.includes("steer text"));
  assert.ok(container.textContent.includes("Image attachment"));
  assert.ok(container.textContent.includes("78%"));

  const recall = byTitle(container, "Remove all queued messages and put them back into the input box for editing");
  await hover(recall);
  await click(recall);
  assert.equal(recalls, 1);
  unmount();
});

test("shows the shell mode hint and the model error banner", async () => {
  const { container, rerender, unmount } = mount(
    baseProps({ modelError: "Invalid models.json schema", modelScopeWarnings: ['No models match "ghost/*"'] }),
  );
  const textarea = textareaOf(container);

  assert.ok(container.querySelector('[role="alert"]').textContent.includes("Invalid models.json schema"));
  assert.ok(container.textContent.includes("No models match"));

  await type(textarea, "!ls");
  assert.ok(container.textContent.includes("Shell"));
  assert.ok(container.textContent.includes("output sent to model"));

  await type(textarea, "!!ls");
  assert.ok(container.textContent.includes("output stays local"));

  rerender(baseProps());
  await settle();
  assert.equal(container.querySelector('[role="alert"]'), null);
  unmount();
});

test("ignores Enter while the IME is composing", async () => {
  const sent = [];
  const { container, unmount } = mount(baseProps({ onSend: (message) => sent.push(message) }));
  const textarea = textareaOf(container);

  await type(textarea, "日本語");
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  await settle();
  await press(textarea, "Enter");
  assert.deepEqual(sent, []);

  textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await settle();
  // 合成结束后的 100ms 宽限期内，Enter 仍然不算提交
  await press(textarea, "Enter");
  assert.deepEqual(sent, []);

  await settle(150);
  await press(textarea, "Enter");
  assert.deepEqual(sent, ["日本語"]);
  unmount();
});

test("collapses the mobile controls menu", async () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });

  try {
    const { container, unmount } = mount(baseProps({ thinkingLevel: "off", onThinkingLevelChange() {} }));
    const more = byLabel(container, "More controls");
    assert.ok(more, "expected the mobile controls trigger");
    await hover(more);
    await click(more);

    const collapse = byLabel(container, "Collapse controls");
    assert.ok(collapse, "expected the controls menu to open");
    await hover(collapse);
    await click(collapse);

    assert.equal(byLabel(container, "Collapse controls"), undefined);
    unmount();
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

test("stacks a compaction error above the textarea and labels image-only queued messages", async () => {
  const { container, unmount } = mount(
    baseProps({ compactError: "Compaction failed", queuedMessages: { steering: ["[Image]"], followUp: [] } }),
  );

  const alert = container.querySelector('[role="alert"]');
  assert.ok(alert);
  assert.ok(alert.textContent.includes("Compaction failed"));
  assert.ok(container.textContent.includes("Image attachment"));
  unmount();
});

test("rekeyDraft forwards a stale composer key to the stored draft", async () => {
  const ref = React.createRef();
  const { container, unmount } = mount(baseProps({ draftKey: "coverage-rekey-current" }), { ref });
  clearDraft("coverage-rekey-stale");
  clearDraft("coverage-rekey-target");
  setDraft("coverage-rekey-stale", { value: "orphan draft", images: [] });

  await apply(() => ref.current.rekeyDraft("coverage-rekey-stale", "coverage-rekey-target"));

  assert.equal(getDraft("coverage-rekey-stale"), null);
  assert.equal(getDraft("coverage-rekey-target").value, "orphan draft");
  assert.equal(textareaOf(container).value, "");

  unmount();
  clearDraft("coverage-rekey-target");
});

test("rekeyDraft merges the composer draft into an existing destination draft", async () => {
  const previousKey = "coverage-rekey-merge-source";
  const nextKey = "coverage-rekey-merge-destination";
  clearDraft(previousKey);
  clearDraft(nextKey);

  const ref = React.createRef();
  const { container, unmount } = mount(baseProps({ draftKey: previousKey }), { ref });
  const textarea = textareaOf(container);
  await attachImageThroughPicker(container);
  await type(textarea, "second");
  setDraft(nextKey, { value: "first", images: [{ data: "AQID", mimeType: "image/png" }] });

  await apply(() => ref.current.rekeyDraft(previousKey, nextKey));

  assert.equal(textarea.value, "first\n\nsecond");
  assert.equal(container.querySelectorAll('img[alt=""]').length, 2);
  assert.equal(getDraft(previousKey), null);
  assert.equal(getDraft(nextKey).value, "first\n\nsecond");

  unmount();
  clearDraft(nextKey);
});

test("swaps drafts when the session key changes", async () => {
  const firstKey = "coverage-swap-first";
  const secondKey = "coverage-swap-second";
  clearDraft(firstKey);
  clearDraft(secondKey);
  setDraft(secondKey, { value: "draft of the second session", images: [{ data: "AQID", mimeType: "image/png" }] });

  const { container, rerender, unmount } = mount(baseProps({ draftKey: firstKey }));
  const textarea = textareaOf(container);
  await type(textarea, "draft of the first session");

  rerender(baseProps({ draftKey: secondKey }));
  await settle();

  assert.equal(textarea.value, "draft of the second session");
  assert.equal(previewOf(container).getAttribute("src"), "data:image/png;base64,AQID");
  assert.deepEqual(getDraft(firstKey), { value: "draft of the first session", images: [] });

  unmount();
  clearDraft(firstKey);
  clearDraft(secondKey);
});

test("routes /rewind to the builtin dispatcher while running without queue handlers", async () => {
  const builtins = [];
  const { container, unmount } = mount(
    baseProps({
      isStreaming: true,
      onBuiltinCommand: async (message) => {
        builtins.push(message);
        return { handled: true, error: "Cannot rewind while the session is busy" };
      },
    }),
  );
  const textarea = textareaOf(container);

  await type(textarea, "/rewind");
  await press(textarea, "Enter");

  assert.deepEqual(builtins, ["/rewind"]);
  assert.equal(textarea.value, "");
  unmount();
});

test("keeps the @ menu usable when the file index request fails", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await type(textarea, "@");
    await settle(20);

    assert.ok(container.textContent.includes("No matching files"));
    unmount();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("completes a quoted @ token without duplicating the closing quote", async () => {
  const restoreFetch = installFetch({ files: ["README.md"] });
  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await typeAt(textarea, '@"RE"', 4);
    await settle(20);
    assert.ok(container.textContent.includes("README.md"));

    await press(textarea, "Tab");
    assert.equal(textarea.value, '@"README.md" ');
    unmount();
  } finally {
    restoreFetch();
  }
});

test("navigates the slash palette with every arrow key", async () => {
  const { container, unmount } = mount(baseProps());
  const textarea = textareaOf(container);

  await type(textarea, "/");
  await press(textarea, "ArrowRight");
  await press(textarea, "ArrowLeft");
  await press(textarea, "ArrowUp");
  await press(textarea, "Enter");
  // ArrowUp 停在第一项
  assert.equal(textarea.value, "/compact ");

  await type(textarea, "/");
  await press(textarea, "ArrowDown");
  await press(textarea, "ArrowDown");
  await press(textarea, "Enter");
  assert.equal(textarea.value, "/name ");

  // 有几何布局时按屏幕位置就近选择下一行
  await type(textarea, "/");
  const items = buttons(container).filter((button) => button.textContent.trim().startsWith("/"));
  assert.ok(items.length > 2);
  items.forEach((item, index) => {
    item.getBoundingClientRect = () => ({
      top: index * 40,
      bottom: index * 40 + 30,
      height: 30,
      left: 0,
      right: 120,
      width: 120,
      x: 0,
      y: index * 40,
    });
  });
  await press(textarea, "ArrowDown");
  await press(textarea, "Enter");
  assert.equal(textarea.value, "/copy ");
  unmount();
});

test("navigates and completes the @ menu with the keyboard", async () => {
  const restoreFetch = installFetch({ files: ["b.ts", "a.ts"] });
  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await type(textarea, "@");
    await settle(20);
    await press(textarea, "ArrowDown");
    await press(textarea, "ArrowUp");
    await press(textarea, "Tab");
    assert.equal(textarea.value, "@a.ts ");
    unmount();
  } finally {
    restoreFetch();
  }
});

test("tracks the caret for the @ menu through selection changes", async () => {
  const restoreFetch = installFetch({ files: ["README.md"] });
  try {
    const { container, unmount } = mount(baseProps({ cwd: "/tmp/project" }));
    const textarea = textareaOf(container);

    await type(textarea, "hi @");
    await settle(20);
    assert.ok(container.textContent.includes("README.md"));

    textarea.focus();
    textarea.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    textarea.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    textarea.setSelectionRange(0, 0);
    textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await settle();

    assert.equal(container.textContent.includes("README.md"), false);
    unmount();
  } finally {
    restoreFetch();
  }
});

test("retries loading slash commands after a failed request", async () => {
  let attempts = 0;
  const { container, unmount } = mount(
    baseProps({
      onLoadSlashCommands: async () => {
        attempts += 1;
        throw new Error("cannot list commands");
      },
    }),
  );
  const textarea = textareaOf(container);

  await type(textarea, "/");
  await settle(20);
  assert.equal(attempts, 1);

  await type(textarea, "");
  await type(textarea, "/");
  await settle(20);
  assert.equal(attempts, 2);
  unmount();
});

test("loads skill dormancy for the slash palette", async () => {
  const restoreFetch = installFetch();
  try {
    const { container, unmount } = mount(
      baseProps({
        cwd: "/tmp/project",
        slashCommands: [{ name: "skill:deploy", description: "Deploy the app", source: "skill" }],
      }),
    );
    const textarea = textareaOf(container);

    await type(textarea, "/");
    await settle(20);

    assert.ok(globalThis.fetch.calls.some((url) => url === "/api/skills?cwd=%2Ftmp%2Fproject"));
    assert.ok(container.textContent.includes("/skill:deploy"));
    assert.ok(container.textContent.includes("dormant"));
    unmount();
  } finally {
    restoreFetch();
  }
});

test("degrades to an unannotated palette when the skills request fails", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

  try {
    const { container, unmount } = mount(
      baseProps({
        cwd: "/tmp/project",
        slashCommands: [{ name: "skill:deploy", description: "Deploy the app", source: "skill" }],
      }),
    );
    const textarea = textareaOf(container);

    await type(textarea, "/");
    await settle(20);

    assert.ok(container.textContent.includes("/skill:deploy"));
    assert.equal(container.textContent.includes("dormant"), false);
    unmount();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("falls back to modelNames when no model list is provided", async () => {
  const changes = [];
  const { container, unmount } = mount(
    baseProps({
      model: null,
      modelList: [],
      modelNames: { "gpt-5.4": "GPT-5.4" },
      onModelChange: (provider, id) => changes.push([provider, id]),
    }),
  );

  assert.ok(byText(container, "Select model"));
  await click(byTitle(container, "Change model"));
  const options = byExactText(container, "GPT-5.4");
  assert.equal(options.length, 1);
  await click(options[0]);
  assert.deepEqual(changes, [["unknown", "gpt-5.4"]]);
  unmount();
});

test("closes the tool, thinking and history popups on an outside click", async () => {
  const { container, unmount } = mount(
    baseProps({
      thinkingLevel: "off",
      onThinkingLevelChange() {},
      toolPreset: "full",
      onToolPresetChange() {},
      inputHistory: ["older prompt"],
    }),
  );
  const textarea = textareaOf(container);

  await click(byLabel(container, "Change tool preset"));
  assert.ok(container.textContent.includes("No tools, read-only"));
  await mouseDown(document.body);
  assert.equal(container.textContent.includes("No tools, read-only"), false);

  await click(byLabel(container, "Change reasoning level"));
  assert.ok(container.textContent.includes("Reasoning off"));
  await mouseDown(document.body);
  assert.equal(container.textContent.includes("Reasoning off"), false);

  await press(textarea, "ArrowUp");
  assert.ok(container.textContent.includes("older prompt"));
  await mouseDown(document.body);
  assert.equal(container.textContent.includes("older prompt"), false);
  unmount();
});

test("hovers the attach and stop buttons and toggles a muted sound icon", async () => {
  let toggles = 0;
  const { container, unmount } = mount(baseProps({ onSoundToggle: () => (toggles += 1) }));
  await hover(byTitle(container, "Attach image"));

  const mutedSound = byLabel(container, "Enable completion sound");
  await hover(mutedSound);
  await click(mutedSound);
  assert.equal(toggles, 1);
  unmount();

  const running = mount(baseProps({ isStreaming: true }));
  const stop = byText(running.container, "Stop");
  await hover(stop);
  await click(stop);
  running.unmount();
});

test("derives the context percentage from tokens and window size", () => {
  const { container, unmount } = mount(baseProps({ contextUsage: { tokens: 64_000, contextWindow: 128_000 } }));

  assert.ok(container.textContent.includes("64k / 128k"));
  assert.ok(container.textContent.includes("50%"));
  unmount();
});
