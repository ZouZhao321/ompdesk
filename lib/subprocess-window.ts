/**
 * 服务端子进程是否隐藏控制台窗口。
 *
 * 后台实例由启动器 detached 拉起，自身没有控制台；Windows 上这种进程再启动控制台程序时，
 * 系统会给每个子进程新建一个可见的控制台窗口。前台实例与启动器共用控制台，子进程保持同组，
 * Ctrl+C 与关闭终端才能送达，此时不隐藏。
 */
const hasConsole = Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY);

export const HIDE_CHILD_WINDOW = !hasConsole;
