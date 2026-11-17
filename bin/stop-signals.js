"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { constants } = require("node:os");

// 启动器把收到的停止信号转给子进程。两个信号都要转：容器里启动器就是 PID 1
// （`Dockerfile` 的 ENTRYPOINT），信号只送到 PID 1；服务管理器按 pid 终止时也只
// 送到启动器。子进程收不到信号就会成为孤儿，继续占着端口。
const STOP_SIGNALS = ["SIGINT", "SIGTERM"];

// 子进程收尾卡住时不能永远等下去：超时后启动器按该信号的值退出。
const FORWARD_TIMEOUT_MS = 5_000;

// 平台上报得出的信号名与编号都在这里：POSIX 的 SIGQUIT/SIGKILL/SIGSEGV、Windows
// 的 SIGBREAK 都只出现在子进程的 `signal` 参数里，`STOP_SIGNALS` 覆盖不到。
const SIGNAL_NUMBERS = new Map(Object.entries(constants.signals));

/** 被信号终止的进程按 shell 惯例收尾：退出码是 128 + 信号值。 */
function signalExitCode(signal) {
  const number = SIGNAL_NUMBERS.get(signal);
  return number === undefined ? null : 128 + number;
}

/**
 * 把 SIGTERM 与 SIGINT 转给子进程，返回注销信号处理函数的方法。
 *
 * `interrupt` 为假时不接管 SIGINT：终端里的 Ctrl+C 按进程组投递，同组的子进程
 * 已经收到一次，再转一次就是第二次信号——子进程里 `process.once("SIGINT")` 的
 * 收尾会被第二次信号的默认动作打断。没有控制台、或启动器是容器里的 PID 1 时，
 * 信号只到启动器，这时才必须转发。
 *
 * 子进程已经退出时不再送信号；无论子进程回不回得来，超时后都按该信号的退出码
 * 收尾，启动器不会一直挂着。
 */
function forwardStopSignals(child, exit, { interrupt = true, timeoutMs = FORWARD_TIMEOUT_MS } = {}) {
  const handlers = [];
  for (const signal of interrupt ? STOP_SIGNALS : ["SIGTERM"]) {
    const handler = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      setTimeout(() => exit(signalExitCode(signal)), timeoutMs).unref();
    };
    process.on(signal, handler);
    handlers.push([signal, handler]);
  }
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

module.exports = { STOP_SIGNALS, forwardStopSignals, signalExitCode };
