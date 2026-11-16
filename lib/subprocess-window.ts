/**
 * 服务端子进程是否隐藏控制台窗口。
 *
 * Windows 上，没有控制台的进程再启动控制台程序时，系统会给每个子进程新建一个可见的控制台
 * 窗口并抢走前台焦点。服务端在终端里运行时与终端共用控制台，子进程保持同组，Ctrl+C 与关闭
 * 终端才带得走它们，此时不隐藏；没有控制台时才隐藏。
 *
 * 判据是三路标准输入输出里有没有终端，是「进程有没有控制台」的近似：三路全部重定向到文件时
 * 会判成没有控制台，子进程随即脱离控制台，关闭终端带不走它们（Ctrl+C 仍由终端发给整个进程组）。
 */
const hasConsole = Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY);

export const HIDE_CHILD_WINDOW = !hasConsole;
