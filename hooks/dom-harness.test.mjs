// hooks 覆盖率测试共用的最小 DOM 替身。
//
// 仓库没有提供 DOM 测试依赖，react-dom/client 只用到少量节点与事件 API，
// 这里按需实现这些 API，让 hook 的 effect、订阅与重渲染走真实的 React 调度。
// 每个用例结束后调用 `restore()` 还原所有被替换的全局。
//
// 文件名带 `.test.mjs` 是故意的：Bun 不把测试文件计入覆盖率，这份脚手架因此
// 不会把自身没被调用的分支算进函数覆盖率分母。它自身不注册用例。

const HTML_NS = "http://www.w3.org/1999/xhtml";

class DomClassList {
  constructor(owner) {
    this.owner = owner;
    this.names = new Set();
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.names.has(name) : Boolean(force);
    if (next) this.names.add(name);
    else this.names.delete(name);
    return next;
  }

  get value() {
    return [...this.names].join(" ");
  }

  set value(text) {
    this.names = new Set(String(text).split(/\s+/).filter(Boolean));
  }
}

function createStyle() {
  const style = {
    setProperty(name, value) {
      style[name] = String(value);
    },
    removeProperty(name) {
      const previous = typeof style[name] === "string" ? style[name] : "";
      delete style[name];
      return previous;
    },
    getPropertyValue(name) {
      return typeof style[name] === "string" ? style[name] : "";
    },
  };
  return style;
}

function createEvent(type, extra = {}) {
  return { type, target: null, currentTarget: null, defaultPrevented: false, preventDefault() {}, ...extra };
}

class DomNode {
  constructor(doc, nodeType) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get previousSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, before) {
    if (!before) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(before);
    child.parentNode = this;
    this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, child);
    return child;
  }

  replaceChild(child, replaced) {
    this.insertBefore(child, replaced);
    this.removeChild(replaced);
    return replaced;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index !== -1) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  dispatchEvent(type, extra) {
    const event = createEvent(type, extra);
    event.target = this;
    event.currentTarget = this;
    [...(this.listeners.get(type) ?? [])].forEach((handler) => handler(event));
    return !event.defaultPrevented;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class DomText extends DomNode {
  constructor(doc, text, nodeType = 3) {
    super(doc, nodeType);
    this.nodeValue = String(text);
    this.data = this.nodeValue;
  }

  get textContent() {
    return this.nodeValue;
  }
}

class DomElement extends DomNode {
  constructor(doc, tagName, namespaceURI = HTML_NS) {
    super(doc, 1);
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.localName = String(tagName).toLowerCase();
    this.namespaceURI = namespaceURI;
    this.style = createStyle();
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new DomClassList(this);
    this.rect = null;
    this.isContentEditable = false;
  }

  get className() {
    return this.classList.value;
  }

  set className(value) {
    this.classList.value = value;
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent ?? "").join("");
  }

  set textContent(value) {
    this.childNodes.forEach((child) => {
      child.parentNode = null;
    });
    this.childNodes = [];
    if (value !== "" && value != null) this.appendChild(new DomText(this.ownerDocument, value));
  }

  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    this.attributes.set(key, String(value));
    if (key === "class") this.classList.value = String(value);
    if (key === "id") this.idValue = String(value);
    if (key === "style") this.style.cssText = String(value);
    if (key.startsWith("data-")) {
      this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    }
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    if (key === "class") return this.classList.value || null;
    if (key === "id") return this.idValue ?? null;
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name) {
    const key = String(name).toLowerCase();
    this.attributes.delete(key);
    if (key === "id") delete this.idValue;
  }

  setBoundingRect(rect) {
    this.rect = { x: 0, y: 0, left: 0, width: 0, height: 0, right: 0, ...rect };
    this.rect.bottom = this.rect.bottom ?? this.rect.top + this.rect.height;
    return this;
  }

  getBoundingClientRect() {
    return this.rect ?? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
}

class DomDocument extends DomNode {
  constructor() {
    super(null, 9);
    this.ownerDocument = this;
    this.documentElement = new DomElement(this, "html");
    this.head = new DomElement(this, "head");
    this.body = new DomElement(this, "body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.childNodes.push(this.documentElement);
    this.activeElement = this.body;
    this.visibilityState = "visible";
    this.defaultView = null;
  }

  createElement(tagName) {
    return new DomElement(this, tagName);
  }

  createElementNS(namespaceURI, tagName) {
    return new DomElement(this, tagName, namespaceURI);
  }

  createTextNode(text) {
    return new DomText(this, text);
  }

  createComment(text) {
    return new DomText(this, text, 8);
  }

  createDocumentFragment() {
    return new DomElement(this, "#fragment");
  }

  getElementById() {
    return null;
  }

  getSelection() {
    return null;
  }

  get textContent() {
    return this.documentElement.textContent;
  }
}

function createStorage(handle) {
  const entries = new Map();
  handle.storage = entries;
  return {
    getItem(key) {
      if (handle.storageError) throw new Error("storage is unavailable");
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      if (handle.storageError) throw new Error("storage is unavailable");
      entries.set(key, String(value));
    },
    removeItem(key) {
      if (handle.storageError) throw new Error("storage is unavailable");
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    get length() {
      return entries.size;
    },
  };
}

/**
 * 安装最小 DOM 环境。
 * @returns 驱动渲染、媒体查询、动画帧与全局还原的句柄
 */
export function installDom() {
  const document = new DomDocument();
  const handle = {
    document,
    storage: new Map(),
    window: null,
    storageError: false,
    scrollCalls: [],
    media: new Map(),
    frames: new Map(),
    nextFrameId: 1,
    observers: [],
    restored: false,
    originals: new Map(),
  };

  const win = {
    document,
    navigator: { language: "en-US", languages: ["en-US"] },
    innerWidth: 1024,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    localStorage: createStorage(handle),
    matchMedia(query) {
      return mediaQuery(handle, String(query));
    },
    addEventListener(type, handler) {
      windowEvents.addEventListener(type, handler);
    },
    removeEventListener(type, handler) {
      windowEvents.removeEventListener(type, handler);
    },
    dispatchEvent(type, extra) {
      return windowEvents.dispatchEvent(type, extra);
    },
    requestAnimationFrame(callback) {
      const id = handle.nextFrameId++;
      handle.frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      handle.frames.delete(id);
    },
    setTimeout,
    clearTimeout,
    getComputedStyle() {
      return { getPropertyValue: () => "" };
    },
    scrollTo(x, y) {
      handle.scrollCalls.push([x, y]);
      win.scrollX = x;
      win.scrollY = y;
    },
  };
  handle.window = win;
  document.defaultView = win;

  // window 监听器单独存放，避免和 document 的事件混在一起。
  const windowEvents = new DomElement(document, "window");
  handle.windowEvents = windowEvents;

  /** 记录回调与目标，测试用 `triggerResizeObservers()` 手动触发一次重排。 */
  class DomResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      this.disconnected = false;
      handle.observers.push(this);
    }

    observe(target) {
      this.targets.push(target);
    }

    unobserve(target) {
      this.targets = this.targets.filter((candidate) => candidate !== target);
    }

    disconnect() {
      this.disconnected = true;
      this.targets = [];
    }

    trigger() {
      this.callback([{ target: this.targets[0] }], this);
    }
  }

  const globals = {
    window: win,
    document,
    localStorage: win.localStorage,
    matchMedia: win.matchMedia,
    ResizeObserver: DomResizeObserver,
    Node: DomNode,
    Element: DomElement,
    HTMLElement: DomElement,
    Document: DomDocument,
    DocumentFragment: DomElement,
    Event: class DomEvent {},
    UIEvent: class DomUIEvent {},
    MouseEvent: class DomMouseEvent {},
    KeyboardEvent: class DomKeyboardEvent {},
    HTMLIFrameElement: class DomIframeElement {},
    HTMLInputElement: class DomInputElement {},
    HTMLTextAreaElement: class DomTextAreaElement {},
    HTMLSelectElement: class DomSelectElement {},
    HTMLButtonElement: class DomButtonElement {},
    HTMLDivElement: class DomDivElement {},
    HTMLAnchorElement: class DomAnchorElement {},
    SVGElement: class DomSvgElement {},
  };
  for (const [name, value] of Object.entries(globals)) {
    handle.originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    globalThis[name] = value;
  }
  // react-dom 从 window 上读取这些构造器做 instanceof 判定。
  for (const name of Object.keys(globals)) {
    if (!(name in win)) win[name] = globals[name];
  }

  handle.mediaQuery = (query) => mediaQuery(handle, String(query));
  handle.setStorageError = (enabled) => {
    handle.storageError = Boolean(enabled);
  };
  handle.emitVisibility = (state) => {
    document.visibilityState = state;
    document.dispatchEvent("visibilitychange");
  };
  handle.setMedia = (query, matches) => {
    const entry = mediaQuery(handle, String(query));
    entry.matches = Boolean(matches);
    entry.emit();
    return entry;
  };
  handle.dispatch = (type, extra) => windowEvents.dispatchEvent(type, extra);
  handle.windowListenerCount = (type) => windowEvents.listenerCount(type);
  handle.runFrames = () => {
    let guard = 0;
    while (handle.frames.size > 0 && guard++ < 64) {
      const batch = [...handle.frames.entries()];
      handle.frames.clear();
      batch.forEach(([, callback]) => callback(0));
    }
  };
  handle.pendingFrames = () => handle.frames.size;
  handle.installVisualViewport = (initial = {}) => {
    const viewport = new DomElement(document, "visual-viewport");
    viewport.height = initial.height ?? win.innerHeight;
    viewport.width = initial.width ?? win.innerWidth;
    viewport.scale = initial.scale ?? 1;
    viewport.offsetTop = initial.offsetTop ?? 0;
    viewport.offsetLeft = initial.offsetLeft ?? 0;
    win.visualViewport = viewport;
    handle.visualViewport = viewport;
    return viewport;
  };
  handle.triggerResizeObservers = () => handle.observers.forEach((observer) => observer.trigger());
  handle.setFetch = (implementation) => {
    if (!handle.originals.has("fetch"))
      handle.originals.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
    globalThis.fetch = implementation;
  };
  handle.restore = () => {
    if (handle.restored) return;
    handle.restored = true;
    for (const [name, descriptor] of handle.originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    handle.frames.clear();
  };
  return handle;
}

function mediaQuery(handle, query) {
  let entry = handle.media.get(query);
  if (!entry) {
    entry = {
      media: query,
      matches: false,
      listeners: new Set(),
      addEventListener(type, handler) {
        if (type === "change") entry.listeners.add(handler);
      },
      removeEventListener(type, handler) {
        if (type === "change") entry.listeners.delete(handler);
      },
      addListener(handler) {
        entry.listeners.add(handler);
      },
      removeListener(handler) {
        entry.listeners.delete(handler);
      },
      emit() {
        [...entry.listeners].forEach((handler) =>
          handler(createEvent("change", { matches: entry.matches, media: entry.media })),
        );
      },
      listenerCount() {
        return entry.listeners.size;
      },
    };
    handle.media.set(query, entry);
  }
  return entry;
}

/**
 * 等待 React 调度完渲染与 effect。
 *
 * `bun test` 里 NODE_ENV 是 production，React 没有 `act`，更新走调度器异步落地，
 * 因此用几轮宏任务把渲染、被动 effect 和状态回写都跑完。
 */
export async function settle(rounds = 6) {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * 挂载一个元素并跑完 React 的 effect。
 * @param element 要渲染的 React 元素
 * @returns 容器与重新渲染、卸载入口
 */
export async function mount(element) {
  const { createRoot } = await import("react-dom/client");
  const document = globalThis.document;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(element);
  await settle();
  return {
    container,
    async rerender(next) {
      root.render(next);
      await settle();
    },
    async unmount() {
      root.unmount();
      await settle();
    },
  };
}
