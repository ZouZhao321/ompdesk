import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";

const sandboxRoot = join(process.cwd(), ".tmp", "lib-logic-one", "omp-runtime");
const agentDir = join(sandboxRoot, "agent");
const otherProjectDir = join(sandboxRoot, "other-project");
const subjectPath = join(process.cwd(), "lib", "omp-runtime.ts");

async function loadSubject() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    interopDefault: true,
    moduleCache: false,
  });
  return jiti.import(subjectPath);
}

// 装配过程中的目录发现会访问网络：离线替身让 refresh 立即失败并走内置目录，
// 用例结束时恢复，避免影响其它用例。
const offlineFetch = async () => {
  throw new Error("offline test runtime");
};
let nativeFetch;

let restoreAgentDir;

before(() => {
  restoreAgentDir = { agentDir: getAgentDir(), env: process.env.PI_CODING_AGENT_DIR };
  rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(otherProjectDir, { recursive: true });
  setAgentDir(agentDir);
});

beforeEach(() => {
  nativeFetch = globalThis.fetch;
  globalThis.fetch = offlineFetch;
  delete globalThis.__ompSettingsPromise;
  delete globalThis.__ompRuntimePromise;
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
  delete globalThis.__ompSettingsPromise;
  delete globalThis.__ompRuntimePromise;
});

after(() => {
  setAgentDir(restoreAgentDir.agentDir);
  if (restoreAgentDir.env === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = restoreAgentDir.env;
  // Settings 仍持有沙箱里 agent.db 的 SQLite 句柄，Windows 上删不掉目录；
  // 沙箱位于 .tmp 下，由下次运行的 before 清理。
});

test("initializes Settings once and shares the same instance", async () => {
  const { getOmpSettings } = await loadSubject();

  const first = getOmpSettings();
  assert.equal(getOmpSettings(), first);
  const settings = await first;

  assert.ok(settings);
  assert.equal(typeof settings.getCwd(), "string");
  assert.equal(await getOmpSettings(), settings);
});

test("assembles the runtime from the shared settings and caches it", async () => {
  const { getOmpRuntime, getOmpSettings } = await loadSubject();

  const runtime = await getOmpRuntime();
  assert.equal(runtime.agentDir, agentDir);
  assert.equal(runtime.settings, await getOmpSettings());
  assert.ok(runtime.authStorage);
  assert.ok(runtime.modelRegistry instanceof ModelRegistry);

  assert.equal(await getOmpRuntime(), runtime);
});

test("reuses shared Settings for the active cwd and clones for another cwd", async () => {
  const { getOmpSettings, getSettingsForCwd } = await loadSubject();

  const shared = await getOmpSettings();
  assert.equal(await getSettingsForCwd(undefined), shared);
  assert.equal(await getSettingsForCwd(shared.getCwd()), shared);

  const cloned = await getSettingsForCwd(otherProjectDir);
  assert.notEqual(cloned, shared);
  assert.equal(cloned.getCwd(), otherProjectDir);
});

test("a failed runtime build clears its own promise so the next call retries", async () => {
  const { getOmpRuntime } = await loadSubject();
  const blocker = join(sandboxRoot, "not-a-directory");
  writeFileSync(blocker, "a file where the agent directory should be");
  setAgentDir(blocker);

  try {
    await assert.rejects(getOmpRuntime(), /EEXIST|ENOTDIR|mkdir/i);
    assert.equal(globalThis.__ompRuntimePromise, undefined);
  } finally {
    setAgentDir(agentDir);
  }

  const runtime = await getOmpRuntime();
  assert.equal(runtime.agentDir, agentDir);
});

test("invalidation drops both cached promises so the next request rebuilds", async () => {
  const { getOmpRuntime, invalidateOmpRuntime } = await loadSubject();

  const runtime = await getOmpRuntime();
  await getOmpRuntime();
  invalidateOmpRuntime();
  assert.equal(globalThis.__ompRuntimePromise, undefined);
  assert.equal(globalThis.__ompSettingsPromise, undefined);

  const rebuilt = await getOmpRuntime();
  assert.notEqual(rebuilt, runtime);
  assert.equal(rebuilt.agentDir, agentDir);
});
