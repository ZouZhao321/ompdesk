/**
 * 场景：故意不隐藏窗口的控制台子进程（反向对照）。
 *
 * 生产代码的每个子进程调用都传了隐藏标志，所以在不执行启动入口时也不会出现窗口；
 * 判定是否有效只能靠这条对照：同一个被测进程形态下，一个不隐藏的控制台程序必须被
 * 窗口枚举看见。
 */
import { spawn } from "node:child_process";

export async function run() {
  await new Promise((resolve, reject) => {
    const child = spawn("cmd.exe", ["/c", "ping -n 4 127.0.0.1 >nul"], {
      stdio: "ignore",
      // 对照组的开关：值不为 1 时不隐藏，窗口应当出现并被判定捕获。
      windowsHide: process.env.OMPDESK_CONSOLE_CONTROL_HIDDEN === "1",
    });
    child.on("error", reject);
    child.on("exit", () => resolve());
  });
}
