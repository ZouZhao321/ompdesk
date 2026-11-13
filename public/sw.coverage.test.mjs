import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

/**
 * Service Worker 的生命周期与取回策略。模块顶层就读取 `self`，所以先把替身放好，
 * 再由注册时捕获的回调驱动：`self.addEventListener` 只记录，不真正安装。
 */
const listeners = new Map();
const CACHE_NAME = "pi-web-static-cov";
const OFFLINE_URL = "/offline.html";

let cacheState;

/**
 * `sw.js` 在每个测试进程里只求值一次，注册时用的 `self` 就成了唯一入口。
 * 这里用一个访问器持有自己的替身，并在别的测试文件装上自己的 `self` 时，
 * 把已捕获的回调按同样名字回放过去——否则同目录的 `sw.test.mjs` 读不到回调。
 */
let selfStub;
const selfSlot = { current: undefined };
Object.defineProperty(globalThis, "self", {
  configurable: true,
  get: () => selfSlot.current,
  set: (value) => {
    if (value && value !== selfStub && typeof value.addEventListener === "function") {
      for (const [type, listener] of listeners) value.addEventListener(type, listener);
    }
    selfSlot.current = value;
  },
});

function installSelfStub() {
  selfStub = {
    location: { href: "https://pi.test/sw.js?v=cov", origin: "https://pi.test" },
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: async () => {
      cacheState.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        cacheState.claimed += 1;
      },
      matchAll: async () => [],
      openWindow: async () => {},
    },
  };
  globalThis.self = selfStub;
}

cacheState = {
  open: [],
  added: [],
  keys: [],
  deleted: [],
  match: [],
  put: [],
  skipWaiting: 0,
  claimed: 0,
};

installSelfStub();
globalThis.caches = {
  open: async (name) => {
    cacheState.open.push(name);
    return {
      addAll: async (urls) => {
        cacheState.added.push(urls);
      },
      put: async (request, response) => {
        cacheState.put.push({ request, response });
      },
    };
  },
  keys: async () => {
    cacheState.keys.push(true);
    return cacheState.cacheKeys ?? [];
  },
  delete: async (key) => {
    cacheState.deleted.push(key);
    return true;
  },
  match: async (request) => {
    cacheState.match.push(request);
    return cacheState.matchResult ?? undefined;
  },
};

await import("./sw.js");

beforeEach(() => {
  cacheState = {
    open: [],
    added: [],
    keys: [],
    deleted: [],
    match: [],
    put: [],
    skipWaiting: 0,
    claimed: 0,
    cacheKeys: [],
    matchResult: undefined,
  };
});

function dispatch(type, event) {
  const listener = listeners.get(type);
  assert.equal(typeof listener, "function", `expected a ${type} listener`);
  listener(event);
  return event;
}

function lifecycleEvent() {
  return {
    pending: undefined,
    waitUntil(promise) {
      this.pending = promise;
    },
  };
}

function fetchEvent(request) {
  return {
    request,
    response: undefined,
    respondWith(response) {
      this.response = response;
    },
  };
}

function httpRequest(url, { method = "GET", mode = "cors" } = {}) {
  return { method, url, mode };
}

test("install precaches the offline shell and icons, then activates at once", async () => {
  const event = dispatch("install", lifecycleEvent());
  await event.pending;

  assert.deepEqual(cacheState.open, [CACHE_NAME]);
  assert.equal(cacheState.added.length, 1);
  assert.deepEqual(cacheState.added[0], [
    OFFLINE_URL,
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/apple-touch-icon.png",
  ]);
  assert.equal(cacheState.skipWaiting, 1);
});

test("activate deletes stale pi-web caches only, then claims the clients", async () => {
  cacheState.cacheKeys = [CACHE_NAME, "pi-web-static-old", "pi-web-runtime-old", "someone-else"];

  const event = dispatch("activate", lifecycleEvent());
  await event.pending;

  assert.equal(cacheState.keys.length, 1);
  assert.deepEqual(cacheState.deleted, ["pi-web-static-old", "pi-web-runtime-old"]);
  assert.equal(cacheState.claimed, 1);
});

test("fetch leaves non-GET, cross-origin, API and sw.js traffic to the network stack", () => {
  for (const request of [
    httpRequest("https://pi.test/sessions", { method: "POST" }),
    httpRequest("https://other.test/sessions"),
    httpRequest("https://pi.test/api/sessions"),
    httpRequest("https://pi.test/sw.js"),
  ]) {
    const event = dispatch("fetch", fetchEvent(request));
    assert.equal(event.response, undefined, `${request.method} ${request.url} must not be intercepted`);
  }
});

test("a navigation request falls back to the cached offline shell when the network fails", async () => {
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  const offline = new Response("<html>offline</html>", { status: 200 });
  cacheState.matchResult = offline;

  const event = dispatch("fetch", fetchEvent(httpRequest("https://pi.test/?session=1", { mode: "navigate" })));
  const response = await event.response;

  assert.equal(response, offline);
  assert.deepEqual(cacheState.match, [OFFLINE_URL]);
});

test("a navigation request reports a network error when the offline shell was never cached", async () => {
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  cacheState.matchResult = undefined;

  const event = dispatch("fetch", fetchEvent(httpRequest("https://pi.test/", { mode: "navigate" })));
  const response = await event.response;

  assert.equal(response.type, "error");
});

test("a navigation request passes the network response straight through while online", async () => {
  const online = new Response("<html>app</html>", { status: 200, headers: { "content-type": "text/html" } });
  globalThis.fetch = async () => online;

  const event = dispatch("fetch", fetchEvent(httpRequest("https://pi.test/", { mode: "navigate" })));
  assert.equal(await event.response, online);
  assert.deepEqual(cacheState.match, []);
});

test("a static asset is served from the cache without touching the network", async () => {
  const request = httpRequest("https://pi.test/_next/static/chunk.js");
  const cached = new Response("cached", { status: 200 });
  cacheState.matchResult = cached;
  globalThis.fetch = async () => assert.fail("a cache hit must not reach the network");

  const event = dispatch("fetch", fetchEvent(request));
  const response = await event.response;

  assert.equal(response, cached);
  assert.deepEqual(cacheState.match, [request]);
});

test("a static asset fetched for the first time is put into the static cache", async () => {
  const request = httpRequest("https://pi.test/icons/icon-192.png");
  // 浏览器网络响应的 type 是 `basic`；构造出来的 Response 不带这个标记。
  const clone = { body: "png-clone" };
  const network = { ok: true, type: "basic", body: "png", clone: () => clone };
  cacheState.matchResult = undefined;
  globalThis.fetch = async (received) => {
    assert.equal(received, request);
    return network;
  };

  const event = dispatch("fetch", fetchEvent(request));
  const response = await event.response;

  assert.equal(response, network);
  assert.deepEqual(cacheState.open, [CACHE_NAME]);
  assert.equal(cacheState.put.length, 1);
  assert.equal(cacheState.put[0].request, request);
  assert.equal(cacheState.put[0].response, clone);
});

test("an unusable static asset response is returned but not cached", async () => {
  const request = httpRequest("https://pi.test/manifest.webmanifest");
  const network = {
    ok: false,
    type: "basic",
    status: 404,
    clone: () => assert.fail("a failed response is not cached"),
  };
  cacheState.matchResult = undefined;
  globalThis.fetch = async () => network;

  const event = dispatch("fetch", fetchEvent(request));
  const response = await event.response;

  assert.equal(response, network);
  assert.deepEqual(cacheState.open, []);
  assert.deepEqual(cacheState.put, []);
});
