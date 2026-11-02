---
name: ompdesk-verify
description: 驱动本地 ompdesk，证明改动在开发模式下真能启动并渲染——拉起 dev server、按用户路径点开侧栏、右侧文件面板与输入区、截图留证、收尾。只要在 ompdesk 上改了 UI、路由、启动期代码（instrumentation.ts、next.config.ts、proxy.ts、SESSION.md 相关），或用户说“验证一下”“怎么确认没坏”“页面打不开”“运行看看”，就先走这里；即使只想确认首页还能不能渲染，也不要用 bun test 的绿灯代替这一步。
---

# ompdesk 本地验证

仓库根用 `git rev-parse --show-toplevel` 确认，下文命令都在仓库根执行。这份 skill 的目标只有一个：
用真实浏览器确认应用能从空状态启动、页面能渲染、目标功能走通，并留下可复查的证据。

`bun test` 与 `bun run build` 覆盖不到开发模式：曾经有一版代码生产构建通过、单测全绿，但开发模式下
首页 500（`instrumentation.ts` 把 `node:path` 带进了 edge 与浏览器产物）。所以只要改动落在启动期代码、
`app/**`、`components/**`、`next.config.ts` 或 `proxy.ts`，都必须走完下面的 Launch → Doctor → Drive →
Evidence → Cleanup。

## Launch

```bash
bun install                                   # 依赖缺失或刚换分支时
OMPDESK_DIST_DIR=.next-smoke bun --bun next dev --webpack -H 127.0.0.1 -p 30199
```

端口 30199 与产物目录 `.next-smoke` 刻意和日常开发（`bun run dev`，30141 与 `.next`）分开，因此可以
在本机已有开发实例时并存。收尾时按端口确认监听进程再结束，见 Cleanup。

就绪判定：日志出现 `✓ Ready` 还不算可用，要等第一次页面请求编译完成。产物目录为空时首次请求一般
需要 15–25 秒（`.next-smoke` 已经有缓存时只要几秒），所以用长超时请求首页：

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 120 http://127.0.0.1:30199/
```

返回 200 才算可用。返回 500、或日志里出现 `Module build failed`、`UnhandledSchemeError`、`Failed to compile`
时，直接读日志末尾定位，不要靠重试掩盖。

CI 走同一条路径：`bun run smoke:dev`（脚本 `scripts/smoke-dev.mjs`）。它启动服务、请求首页与 `/api/home`、
扫描失败标记，任一不满足就以非零状态退出并打印日志末尾。只想知道“能不能起来”时优先用它。

## Doctor

开始驱动前先确认这个实例值得驱动：

```bash
curl -s http://127.0.0.1:30199/api/home | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:30199/api/agent/running
```

两个接口都 200 再继续。若 `~/.omp/agent/ompdesk-auth.json` 存在，说明启用了密码锁，所有请求都需要
Basic 认证，服务端日志里的 `authEnabled` 会是 true；验证时不要关掉密码锁去迁就流程。

## Drive

用本机浏览器 harness 驱动，先开一个标签页：

```js
const tab = await browser.open({
  name: "ompdesk-verify",
  url: "http://127.0.0.1:30199/",
  viewport: { width: 1440, height: 900 },
});
await tab.waitForSelector(".sidebar-container", { timeout: 60000 });
```

稳定句柄（优先用类名与 data 属性，文案与 aria-label 会随界面语言变化）：

- 侧栏：`.sidebar-container`、`[data-project-path]`、`[data-session-id]`、搜索框 `input[type=search]`、
  侧栏开关 `[data-toggle="sidebar"]`。
  `.sidebar-session-row` / `.sidebar-project-row` 与上面的 data 属性同时存在；判断行数用 data 属性。
- 右侧文件面板：`#file-panel`、`.panel-tab-header`、`.right-panel-open`、`.right-panel-closed`、
  面板开关 `button[aria-controls="file-panel"]`（同一个属性也出现在宽度为 0 的拖拽分隔条上，要带 `button`）
- 输入区：`textarea`、`[data-context-available]`、`[data-context-level]`、`[data-resize-handle="sidebar"]`、
  `[data-resize-handle="right-panel"]`
- 顶栏按钮没有统一类名，用 `aria-label` 时先把语言固定下来，或改用面板类名的出现与消失判断结果。

与改动相关的用户路径写在 `features/`：先读 `features/README.md` 选一条，再按其中的步骤执行。

手机档下面板与抽屉都是全屏覆盖层，打开时会盖住顶栏按钮；操作顶栏前先关掉当前覆盖层，否则点击会被判为
被遮挡。

## Evidence

证据写到 `.verify/<yyyymmdd-hhmm>/`，这个目录已被忽略，不要提交：

- `page.png`：目标界面的截图（整页或目标面板）
- `http.json`：`/api/home`、`/api/agent/running` 以及相关接口的状态码和截断响应
- `server.log`：dev server 日志末尾；失败时必须留
- `notes.md`：改了什么、期望什么、实际看到什么

证明标准：走用户路径，不调用内部 setter 或测试专用接口；动作与结果状态都要留证；有副作用（新建会话、
写入文件、打开页签）时核对副作用本身；不允许为了让流程通过而放宽步骤或跳过入口。

## Cleanup

只结束自己启动的进程，不要按进程名批量结束。启动命令回显的 PID 不一定是真正监听端口的进程（包装进程与
服务进程可能不同），按端口找监听者：

```bash
# macOS / Linux
lsof -i :30199 -t
# Windows
netstat -ano | findstr :30199
```

也可以读服务日志里的 `process.start` 记录，其中的 `pid` 就是监听进程。结束它之后再确认端口已释放：
`curl` 首页失败或连接被拒即说明已退出。

`.next-smoke/` 已进入忽略列表，可留可删；`.verify/` 下的证据不要删，它是这次验证的结论。

## Helpers

- `bun run smoke:dev` → `scripts/smoke-dev.mjs`。环境变量：`OMPDESK_SMOKE_PORT`（默认 30199）、
  `OMPDESK_DIST_DIR`（默认 `.next-smoke`）、`OMPDESK_SMOKE_STARTUP_MS`（默认 240000）。
- 失败时脚本会打印它收集到的开发服务器日志末尾，通常已经足够定位编译错误。

## Feature map

`features/README.md` 是索引。每个功能文件写清：子功能、用户从哪里进入、用上面的句柄怎么驱动、
可见的完成状态、以及已知的坑。新功能和新的稳定句柄要回流到这些文件，否则下一次验证会退化成猜选择器。
