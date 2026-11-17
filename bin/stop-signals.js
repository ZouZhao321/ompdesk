"use strict";

// 启动器把收到的停止信号转给子进程。两个信号都要转：容器里启动器就是 PID 1
// （`Dockerfile` 的 ENTRYPOINT），信号只送到 PID 1；服务管理器按 pid 终止时也只
// 送到启动器。子进程收不到信号就会成为孤儿，继续占着端口。
const STOP_SIGNALS = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
];

// 子进程收尾卡住时不能永远等下去：超时后启动器按该信号的值退出。
const FORWARD_TIMEOUT_MS = 5_000;

/** 被信号终止的进程按 shell 惯例收尾：退出码是 128 + 信号值。 */
function signalExitCode(signal) {
  const entry = STOP_SIGNALS.find(([name]) => name === signal);
  return entry ? entry[1] : null;
}

/**
 * 把 SIGINT 与 SIGTERM 转给子进程，返回注销信号处理函数的方法。
 *
 * 子进程已经退出时不再送信号；无论子进程回不回得来，超时后都按该信号的退出码
 * 收尾，启动器不会一直挂着。
 */
function forwardStopSignals(child, exit, timeoutMs = FORWARD_TIMEOUT_MS) {
  const handlers = [];
  for (const [signal, code] of STOP_SIGNALS) {
    const handler = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      setTimeout(() => exit(code), timeoutMs).unref();
    };
    process.on(signal, handler);
    handlers.push([signal, handler]);
  }
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

module.exports = { STOP_SIGNALS, forwardStopSignals, signalExitCode };
