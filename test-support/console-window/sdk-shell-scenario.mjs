/**
 * 场景：agent 执行命令走的 SDK 原生 shell。
 *
 * 这条路径不接受 `windowsHide`：`executeShell` 直接起控制台程序，窗口是否可见只取决于宿主
 * 进程有没有一个隐藏的控制台。生产侧其它子进程调用都自带隐藏标志，只有这里能把「不带启动
 * 入口就该出现窗口」暴露出来，所以它承担正反对照的两个方向。
 *
 * 命令失败即抛错，由被测进程入口写进结果文件。
 */
export async function run() {
  const natives = await import("@oh-my-pi/pi-natives");
  const result = await natives.executeShell({ command: "git status --short", cwd: process.cwd() });
  if (result.cancelled) throw new Error("SDK shell 执行被取消");
  if (result.timedOut) throw new Error("SDK shell 执行超时");
  if (result.exitCode !== 0) throw new Error(`SDK shell 退出码非零：${String(result.exitCode)}`);
}
