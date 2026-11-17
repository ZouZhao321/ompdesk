import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { forwardStopSignals, signalExitCode } = require("../bin/stop-signals.js");

function fakeChild({ exited = false } = {}) {
  const kills = [];
  return {
    kills,
    exitCode: exited ? 0 : null,
    signalCode: exited ? "SIGTERM" : null,
    kill: (signal) => kills.push(signal),
  };
}

test("forwards SIGINT and SIGTERM to the child", () => {
  // 只转 SIGTERM 时，`kill -INT` 到启动器（容器里它是 PID 1）就停了，next 成为
  // 孤儿继续占着端口。
  const child = fakeChild();
  const exits = [];
  const stop = forwardStopSignals(child, (code) => exits.push(code), 0);
  try {
    process.emit("SIGINT");
    process.emit("SIGTERM");
  } finally {
    stop();
  }
  assert.deepEqual(child.kills, ["SIGINT", "SIGTERM"]);
});

test("exits with 128 plus the signal value", async () => {
  const child = fakeChild();
  const exits = [];
  const stop = forwardStopSignals(child, (code) => exits.push(code), 0);
  try {
    process.emit("SIGINT");
    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    stop();
  }
  assert.deepEqual(exits, [130, 143]);
});

test("does not signal a child that already exited", async () => {
  const child = fakeChild({ exited: true });
  const exits = [];
  const stop = forwardStopSignals(child, (code) => exits.push(code), 0);
  try {
    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    stop();
  }
  assert.deepEqual(child.kills, []);
  assert.deepEqual(exits, [143], "启动器仍按该信号的值收尾");
});

test("unregisters its handlers", () => {
  const child = fakeChild();
  const exits = [];
  const stop = forwardStopSignals(child, (code) => exits.push(code), 0);
  stop();
  process.emit("SIGINT");
  assert.deepEqual(child.kills, []);
  assert.deepEqual(exits, []);
});

test("maps a child killed by a signal to the shell exit code", () => {
  assert.equal(signalExitCode("SIGINT"), 130);
  assert.equal(signalExitCode("SIGTERM"), 143);
  assert.equal(signalExitCode("SIGKILL"), null);
  assert.equal(signalExitCode(null), null);
});
