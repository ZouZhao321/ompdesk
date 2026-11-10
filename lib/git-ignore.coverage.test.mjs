import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

const state = { scenario: "success", spawns: [] };

class FakeChild extends EventEmitter {
  constructor({ withStdout = true, withStdin = true } = {}) {
    super();
    this.stdout = withStdout ? new EventEmitter() : null;
    this.stdin = withStdin
      ? Object.assign(new EventEmitter(), {
          written: null,
          end(chunk) {
            this.written = chunk;
          },
        })
      : null;
    this.killed = false;
  }

  kill() {
    this.killed = true;
  }
}

function spawnImpl(command, args, options) {
  state.spawns.push({ command, args, options });
  if (state.scenario === "throw") throw new Error("spawn ENOENT");

  const child =
    state.scenario === "no-stdout"
      ? new FakeChild({ withStdout: false })
      : state.scenario === "no-stdin"
        ? new FakeChild({ withStdin: false })
        : new FakeChild();
  if (state.scenario === "no-stdout" || state.scenario === "no-stdin") return child;

  queueMicrotask(() => {
    switch (state.scenario) {
      case "success":
        child.stdout.emit("data", Buffer.from("a\0b\0"));
        child.emit("close", 0);
        break;
      case "no-matches":
        child.emit("close", 1);
        break;
      case "failure":
        child.emit("close", 2);
        break;
      case "stdout-error":
        child.stdout.emit("error");
        child.emit("close", 0);
        break;
      case "child-error":
        child.emit("error");
        break;
      default:
        // "timeout": 保持挂起，由假定时器触发超时。
        break;
    }
  });
  return child;
}

// 模块在加载时取走 `spawn`；替换后立刻还原，避免把替身留给同一进程里的其它用例。
const require = createRequire(import.meta.url);
const childProcess = require("child_process");
const originalSpawn = childProcess.spawn;
childProcess.spawn = spawnImpl;
let checkIgnoredEntries;
try {
  ({ checkIgnoredEntries } = await import("./git-ignore.ts"));
} finally {
  childProcess.spawn = originalSpawn;
}

function reset(scenario) {
  state.scenario = scenario;
  state.spawns = [];
}

test("asks git for ignored names and parses NUL-separated output", async () => {
  reset("success");
  const result = await checkIgnoredEntries(`/repo/success-${Date.now()}`, ["a", "b", "c"]);

  assert.deepEqual([...result].sort(), ["a", "b"]);
  assert.equal(state.spawns.length, 1);
  assert.equal(state.spawns[0].command, "git");
  assert.deepEqual(state.spawns[0].args.slice(2), ["check-ignore", "-z", "--stdin"]);
  assert.equal(state.spawns[0].options.stdio[0], "pipe");
});

test("returns an empty set without asking git when there is nothing to check", async () => {
  reset("success");
  assert.deepEqual(await checkIgnoredEntries("/repo/empty", []), new Set());
  assert.equal(state.spawns.length, 0);
});

test("distinguishes 'nothing matched', a failure, and broken pipes", async () => {
  const dir = `/repo/codes-${Date.now()}`;
  reset("no-matches");
  assert.deepEqual(await checkIgnoredEntries(`${dir}/a`, ["file"]), new Set());

  reset("failure");
  assert.equal(await checkIgnoredEntries(`${dir}/b`, ["file"]), null);

  reset("stdout-error");
  assert.equal(await checkIgnoredEntries(`${dir}/c`, ["file"]), null);

  reset("child-error");
  assert.equal(await checkIgnoredEntries(`${dir}/d`, ["file"]), null);
});

test("returns null when git cannot be started or its pipes are missing", async () => {
  reset("throw");
  assert.equal(await checkIgnoredEntries(`/repo/throw-${Date.now()}`, ["file"]), null);

  reset("no-stdout");
  assert.equal(await checkIgnoredEntries(`/repo/no-stdout-${Date.now()}`, ["file"]), null);
  reset("no-stdin");
  assert.equal(await checkIgnoredEntries(`/repo/no-stdin-${Date.now()}`, ["file"]), null);
});

test("kills a git that outlives the check timeout", async (t) => {
  reset("timeout");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const waiting = checkIgnoredEntries(`/repo/timeout-${Date.now()}`, ["file"]);
  t.mock.timers.tick(10_000);

  assert.equal(await waiting, null);
});

test("serves repeated checks of the same names from the cache", async () => {
  const dir = `/repo/cache-${Date.now()}`;
  reset("success");
  const first = await checkIgnoredEntries(dir, ["a"]);
  const second = await checkIgnoredEntries(dir, ["a"]);

  assert.deepEqual([...first].sort(), ["a", "b"]);
  assert.deepEqual([...second].sort(), ["a", "b"]);
  assert.equal(state.spawns.length, 1);
});
