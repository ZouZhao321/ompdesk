"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { constants } = require("node:os");

// 启动器把收到的停止信号转给子进程。两个信号都要转：容器里启动器就是 PID 1
// （`Dockerfile` 的 ENTRYPOINT），信号只送到 PID 1；服务管理器按 pid 终止时也只
// 送到启动器。子进程收不到信号就会成为孤儿，继续占着端口。
const STOP_SIGNALS = ["SIGINT", "SIGTERM"];

// 子进程收尾卡住时不能永远等下去：超时后启动器按该信号的退出码退出。
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
 * 是否需要把 SIGINT 转给子进程。
 *
 * 有控制台时终端按进程组投递 Ctrl+C，同组的子进程已经收到一次；只有启动器单独
 * 收到信号的情形才需要转发：没有控制台的服务管理器，以及容器里作为 PID 1 的
 * 启动器（`docker stop` 只送到 PID 1）。
 */
function shouldForwardInterrupt({ hasConsole, pid }) {
  return !hasConsole || pid === 1;
}

/**
 * 把 SIGTERM 与 SIGINT 转给子进程，返回注销信号处理函数的方法。
 *
 * `interrupt` 为假时不转发 SIGINT：终端里的 Ctrl+C 按进程组投递，同组的子进程
 * 已经收到一次，再转一次就是第二次信号。但启动器自己这一份也必须接住——默认动作
 * 会让启动器先于子进程退出，子进程的 stdout 管道读端随之关闭，收尾中再写日志就
 * 会拿到 EPIPE。接住之后启动器等子进程自己走完，超时按 130 收尾；重复按 Ctrl+C
 * 同样被接住，等待时间由这个超时兜底，不会无限挂着。
 *
 * 子进程已经退出时不再送信号。超时后还活着就补一次 SIGKILL：启动器退出后管道读端
 * 关闭、子进程成为孤儿继续占着端口，比强行结束一次卡住的收尾代价更大。
 */
function forwardStopSignals(child, exit, { interrupt = true, timeoutMs = FORWARD_TIMEOUT_MS } = {}) {
  const handlers = [];
  // 先后到达的多个信号只按第一个设一次兜底：`exit` 是调用方注入的收尾动作，
  // 重复执行没有意义。
  let armed = false;
  let fallback;
  const armExit = (signal) => {
    if (armed) return;
    armed = true;
    fallback = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      exit(signalExitCode(signal));
    }, timeoutMs);
    fallback.unref();
  };
  const forward = (signal) => () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    armExit(signal);
  };
  const forwarded = interrupt ? STOP_SIGNALS : STOP_SIGNALS.filter((signal) => signal !== "SIGINT");
  for (const signal of forwarded) {
    const handler = forward(signal);
    process.on(signal, handler);
    handlers.push([signal, handler]);
  }
  if (!interrupt) {
    // 每一次 SIGINT 都要接住：收尾窗口里用户常会再按一次 Ctrl+C，`once` 只挡住
    // 第一次，第二次就退回默认动作，启动器仍然抢在子进程前面退出。
    const absorb = () => armExit("SIGINT");
    process.on("SIGINT", absorb);
    handlers.push(["SIGINT", absorb]);
  }
  return () => {
    clearTimeout(fallback);
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

module.exports = { forwardStopSignals, shouldForwardInterrupt, signalExitCode };
