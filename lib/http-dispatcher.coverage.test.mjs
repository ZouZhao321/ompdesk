import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { mock } from "bun:test";

const subjectPath = join(process.cwd(), "lib", "http-dispatcher.ts");

let state;

function resetState() {
  state = { clients: [], pools: [], agents: [], globalDispatcher: undefined, installs: 0 };
  delete globalThis.__ompdeskHttpDispatcherConfigured;
  delete globalThis.__ompdeskHttpDispatcherConfiguring;
}

class FakeClient extends EventEmitter {
  constructor(origin, options) {
    super();
    this.origin = origin;
    this.options = options;
    state.clients.push(this);
  }
}

class FakePool extends EventEmitter {
  constructor(origin, options) {
    super();
    this.origin = origin;
    this.options = options;
    state.pools.push(this);
  }
}

class FakeEnvHttpProxyAgent extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    state.agents.push(this);
  }
}

mock.module("undici", () => ({
  Client: FakeClient,
  Pool: FakePool,
  EnvHttpProxyAgent: FakeEnvHttpProxyAgent,
  setGlobalDispatcher(dispatcher) {
    state.globalDispatcher = dispatcher;
  },
  install() {
    state.installs += 1;
  },
}));

async function loadSubject() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    interopDefault: true,
    moduleCache: false,
  });
  return jiti.import(subjectPath);
}

async function withNodeRuntime(callback) {
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, "bun");
  delete process.versions.bun;
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(process.versions, "bun", descriptor);
  }
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  // 进程级一次性标记会挡住同进程里既有 http-dispatcher 用例的“配置一次”断言。
  delete globalThis.__ompdeskHttpDispatcherConfigured;
  delete globalThis.__ompdeskHttpDispatcherConfiguring;
});

after(() => {
  delete globalThis.__ompdeskHttpDispatcherConfigured;
  delete globalThis.__ompdeskHttpDispatcherConfiguring;
});

test("rejects unparseable idle timeouts before touching undici", async () => {
  const { configureHttpDispatcher } = await loadSubject();

  for (const invalid of ["", "   ", "nope", -1, Number.NaN, Number.POSITIVE_INFINITY, null, {}, []]) {
    await withNodeRuntime(() => {
      assert.throws(() => configureHttpDispatcher(invalid), /Invalid HTTP idle timeout/);
    });
  }
  assert.deepEqual(state.agents, []);
});

test("does not configure anything on Bun's runtime", async () => {
  const { configureHttpDispatcher } = await loadSubject();

  assert.equal(configureHttpDispatcher(2_000), undefined);
  assert.equal(configureHttpDispatcher(5_000), undefined);
  assert.deepEqual(state.agents, []);
  assert.equal(state.installs, 0);
});

test("builds the proxy agent, installs the dispatcher, and wires both factories", async () => {
  const { configureHttpDispatcher } = await loadSubject();

  await withNodeRuntime(() => configureHttpDispatcher(" 2500 "));

  assert.equal(state.agents.length, 1);
  const agent = state.agents[0];
  assert.equal(agent.options.allowH2, false);
  assert.equal(agent.options.bodyTimeout, 2_500);
  assert.equal(agent.options.headersTimeout, 2_500);
  assert.equal(state.globalDispatcher, agent);
  assert.equal(state.installs, 1);
  assert.equal(globalThis.__ompdeskHttpDispatcherConfigured, true);

  const directClient = agent.options.clientFactory("http://direct.example:8080", { connections: 4 });
  assert.equal(directClient, state.clients[0]);
  assert.equal(directClient.origin, "http://direct.example:8080");
  assert.deepEqual(directClient.options, { connections: 4 });
  assert.doesNotThrow(() => directClient.emit("error", new Error("client reset")));

  const pool = agent.options.factory("http://pooled.example:9090", { connections: 2 });
  assert.equal(pool, state.pools[0]);
  assert.equal(pool.origin, "http://pooled.example:9090");
  assert.equal(pool.options.connections, 2);
  assert.equal(typeof pool.options.factory, "function");
  assert.doesNotThrow(() => pool.emit("error", new Error("pool reset")));

  const pooledClient = pool.options.factory("http://pooled.example:9090", { connections: 2 });
  assert.equal(pooledClient, state.clients[1]);
  assert.equal(pooledClient.origin, "http://pooled.example:9090");
  assert.doesNotThrow(() => pooledClient.emit("error", new Error("client reset")));

  const singleConnectionClient = agent.options.factory("http://single.example:7070", { connections: 1 });
  assert.equal(singleConnectionClient, state.clients[2]);
  assert.equal(singleConnectionClient.origin, "http://single.example:7070");
  assert.equal(state.pools.length, 1);
});

test("accepts disabled, numeric, and numeric-string timeouts", async () => {
  const { configureHttpDispatcher } = await loadSubject();

  await withNodeRuntime(() => configureHttpDispatcher("disabled"));
  assert.equal(state.agents[0].options.bodyTimeout, 0);
  assert.equal(state.agents[0].options.headersTimeout, 0);

  resetState();
  await withNodeRuntime(() => configureHttpDispatcher(0));
  assert.equal(state.agents[0].options.bodyTimeout, 0);

  resetState();
  await withNodeRuntime(() => configureHttpDispatcher("1250"));
  assert.equal(state.agents[0].options.bodyTimeout, 1_250);

  resetState();
  await withNodeRuntime(() => configureHttpDispatcher(1_250.9));
  assert.equal(state.agents[0].options.bodyTimeout, 1_250);
});

test("returns the in-flight configuration promise and configures only once", async () => {
  const { configureHttpDispatcher } = await loadSubject();

  await withNodeRuntime(() => {
    const first = configureHttpDispatcher(1_000);
    const second = configureHttpDispatcher(1_000);
    assert.ok(first instanceof Promise);
    assert.equal(second, first);
    return first;
  });

  assert.equal(state.agents.length, 1);
  assert.equal(globalThis.__ompdeskHttpDispatcherConfiguring, undefined);

  assert.equal(await configureHttpDispatcher(1_000), undefined);
  assert.equal(state.agents.length, 1);
});

test("keeps an intentional fetch override installed after module load", async () => {
  const nativeFetch = globalThis.fetch;
  const customFetch = async () => new Response("custom");
  globalThis.fetch = customFetch;
  try {
    const { configureHttpDispatcher } = await loadSubject();
    await withNodeRuntime(() => configureHttpDispatcher(1_000));
  } finally {
    globalThis.fetch = nativeFetch;
  }

  assert.equal(state.agents.length, 1);
  assert.equal(state.installs, 0);
});
