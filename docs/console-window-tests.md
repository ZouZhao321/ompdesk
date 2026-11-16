# 无控制台进程的子进程窗口测试

后台实例的服务进程没有控制台。Windows 上这种进程每启动一个控制台程序，系统就新分配一个
可见的控制台窗口并抢走前台焦点。这一组测试在无控制台进程里跑真实命令，确认不出现窗口，
并确认命令结果没有因此改变。

## 判据

判据是「被测进程存活期间新增的可见 `ConsoleWindowClass` 窗口数」，轮询间隔 5 毫秒。
真实 git 单次调用存活 40 毫秒上下；间隔放到 15 毫秒时，200 次调用只能命中 14 次。

不用另外两种看起来更直接的判据：

- `GetConsoleWindow()` 为 0：给宿主补上隐藏控制台后，子进程仍然有控制台句柄，只是窗口
  不可见（本机实测句柄非 0、`IsWindowVisible` 为 false）。
- 不存在自己的 `conhost.exe` 子进程：隐藏与未隐藏两种写法下该子进程都存在，无法区分。

## 结构

- `test-support/console-window-guard.mjs`：窗口轮询、被测进程脚手架与
  `consoleWindowCheck` 选项。
- `test-support/console-window-subject.mjs`：被测进程入口。`with` 先执行
  `instrumentation.register()`，再跑场景模块。
- `test-support/console-window/*.mjs`：各命令的场景，导出 `run()`，用
  `process.env` 接收夹具路径。
- `test-support/console-window-guard.test.mjs`：反向对照与 git 状态、diff 的覆盖。

被测进程以 detached、隐藏窗口、输出丢弃的方式启动，与后台实例同形。场景里的失败经结果
文件带回：被测进程的标准输出被丢弃，断言不能靠读它的输出。

## 覆盖范围

- git 状态与 diff
- worktree 列举、创建、删除，含脏工作区拒绝删除
- 文件树列举与 Git 忽略判定，含非 git 目录的降级返回
- npx 版本查询、更新命令的构建（只构建，不执行安装）、技能更新参数拼接
- 会话导出：成功路径与「会话不存在」的失败路径
- 两种模式下的结果成对比对：同一批命令在「补隐藏控制台」与「不补」两种模式下快照必须一致

不覆盖：真实全局安装、依赖外网的技能检查、GUI 子系统程序（本来就不分配控制台）。

## 运行

```bash
bun test test-support/console-window-guard.test.mjs
bun test test-support/console-window
```

用例只在 Windows 上运行；其它平台在注册时跳过并写明原因。

## CI

不进 CI。判定依赖真实桌面会话里可枚举的可见窗口，托管 runner 上该条件无法保证；纳入会
带来「永远为 0」的假通过。改动涉及子进程调用或启动流程时在本机跑一次上面两条命令。
