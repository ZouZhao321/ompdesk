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
  const stop = forwardStopSignals(child, (code) => exits.push(code), { timeoutMs: 0 });
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
  const stop = forwardStopSignals(child, (code) => exits.push(code), { timeoutMs: 0 });
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
  const stop = forwardStopSignals(child, (code) => exits.push(code), { timeoutMs: 0 });
  try {
    process.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    stop();
  }
  assert.deepEqual(child.kills, []);
  assert.deepEqual(exits, [143], "启动器仍按该信号的值收尾");
});

test("leaves SIGINT alone when the terminal already delivered it", () => {
  // 终端里 Ctrl+C 送到整组进程：子进程已经收到 SIGINT，启动器再转一次，子进程里
  // `process.once("SIGINT")` 的收尾就被第二次信号的默认动作打断了。
  const child = fakeChild();
  const exits = [];
  const stop = forwardStopSignals(child, (code) => exits.push(code), { interrupt: false, timeoutMs: 0 });
  try {
    process.emit("SIGINT");
    process.emit("SIGTERM");
  } finally {
    stop();
  }
  assert.deepEqual(child.kills, ["SIGTERM"]);
});

test("unregisters its handlers", () => {
  const child = fakeChild();
  const exits = [];
  const stop = forwardStopSignals(child, (code) => exits.push(code), { timeoutMs: 0 });
  stop();
  process.emit("SIGINT");
  assert.deepEqual(child.kills, []);
  assert.deepEqual(exits, []);
});

test("maps a child killed by a signal to the shell exit code", () => {
  assert.equal(signalExitCode("SIGINT"), 130);
  assert.equal(signalExitCode("SIGTERM"), 143);
  // 只映射 SIGINT/SIGTERM 会让 SIGKILL、SIGSEGV 这类致命信号落到 0：服务管理器把
  // 「被信号杀死」当成正常结束，就不会重启。
  assert.equal(signalExitCode("SIGKILL"), 137);
  assert.equal(signalExitCode("SIGQUIT"), 131);
  assert.equal(signalExitCode("SIGSEGV"), 139);
  assert.equal(signalExitCode(null), null);
  assert.equal(signalExitCode("NOT_A_SIGNAL"), null);
});
