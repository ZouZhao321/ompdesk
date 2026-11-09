---
name: ompdesk-dev
description: 在本仓库（ompdesk）里开发的入口——改哪一块、动手前怎么找到当前实现、改完哪条检查会报错。任务发生在这个仓库内（改界面、改 API、改会话读取、改模型与凭据、改启动期代码、排障）就先读这里；即使只说“修个 bug”“加个接口”“页面白屏”，也先按这里的路线定位与验证，不要从零翻仓库。
---

# ompdesk 开发路线

仓库根用 `git rev-parse --show-toplevel` 确认。完整规范在 `AGENTS.md`，两处冲突以 `AGENTS.md` 为准。

本文件不写当前实现叫什么，每条不变量只给三段：

- **行为**：这类改动必须成立的事实。
- **定位**：在当前代码里怎么找到承载它的实现，命令可以直接执行。
- **判警**：破坏它时哪条检查会失败；没有自动检查的，写清只能靠哪一步人工核对。

文件里出现的标识符，动手前先 `git grep -n "<名字>"` 核验。搜不到就当它已经改名，按「定位」重新找，
不要照着旧名字写代码。

## 代码地图

| 位置 | 做什么 | 改它时通常还要看 |
|---|---|---|
| `app/api/**/route.ts` | HTTP 入口，统一请求包装 | `lib/rpc-manager.ts`、同目录 `*.test.mjs` |
| `lib/rpc-manager.ts` | 会话进程的生命周期、注册表、启动互斥 | `lib/omp-runtime.ts` |
| `lib/session-reader.ts` | 解析 `.jsonl`、会话列表与缓存、上下文重建 | `lib/normalize.ts` |
| `lib/omp-runtime.ts` | 全局设置、认证存储、模型表的单例 | 凭据与 `models.yml` 的写入方 |
| `lib/mobile-layout.ts` | 移动档媒体查询与最小命中区常量 | `app/globals.css`、`hooks/useIsMobile.ts` |
| `components/` | 界面；`AppShell` 负责布局与右侧面板标签 | `app/globals.css`、`hooks/` |
| `hooks/` | 流式、SSE、视口、主题等客户端状态 | 对应的 `components/` 使用方 |
| `proxy.ts` | 请求前校验：主机允许列表、密码锁 | `bin/web-auth-store.js` |
| `instrumentation.ts` | 进程启动引导：日志、HTTP dispatcher | 只能走运行时导入，见不变量 4 |
| `next.config.ts` | 产物目录覆盖、SDK 外部化 | `scripts/smoke-dev.mjs` |
| `bin/` | 启动器与密码存储（CommonJS，npm 包里只有它与 `.next`） | `proxy.ts` |
| `app/globals.css` | 两套主题与移动档媒体查询 | `lib/mobile-layout.ts` |

## 不变量

### 1. 写会话数据后，会话列表缓存必须失效

- 行为：新建、重命名、归档、删除、fork 这类写会话文件的路径，都要让会话列表缓存失效。否则侧边栏
  读到旧列表，页面不报错。
- 定位：`git grep -n "invalidate" -- lib/session-reader.ts` 找到缓存失效入口；现有调用点用
  `git grep -rn "invalidateSessionListCache" -- app` 参照。
- 判警：没有自动检查。验证阶梯第 5 步核对副作用：新建会话后侧边栏立刻出现新行。

### 2. 凭据、模型表与角色的写入要同时失效运行时与模型缓存

- 行为：写入后两个缓存都失效。只失效一个的表现是设置页已经更新、会话仍用旧模型。运行时是进程内
  单例，不要为单个请求新建。
- 定位：`git grep -rn "invalidate" -- lib/omp-runtime.ts`；调用点用
  `git grep -rn "invalidateOmpRuntime\|invalidateModelsCache" -- app`。
- 判警：没有自动检查。改完登录一次或改一个密钥，立刻请求模型列表必须看到新模型，再发一轮消息确认
  会话侧同步。

### 3. 每个 API 路由都过统一请求包装，并在内部做前置校验

- 行为：非 SSE 的 GET 与全部写请求都把处理函数交给统一包装导出，模板串必须与所在目录推导出的路径一致
  （`export const POST = withRequestLog("/api/x", handler)`）。路由内部先校验来源（不允许返回 403），
  写请求再校验内容类型（不是 JSON 返回 415）。新增 `/api/**` 自动继承主机允许列表与密码锁，不需要
  改 `proxy.ts`。
- 定位：包装函数用 `git grep -n "export function withRequestLog" -- lib` 找；SSE 路由名单在
  `git grep -n "SSE_ROUTES" -- lib/api-route-inventory-read.test.mjs`；写请求数量下限在同一目录的
  write 清点测试里。
- 判警：`lib/api-route-inventory-read.test.mjs` 与 `lib/api-route-inventory-write.test.mjs`，
  不合规时 `bun test` 直接失败。

### 4. 启动期代码只用运行时导入

- 行为：`instrumentation.ts`、`next.config.ts`、`proxy.ts` 里加载本地服务端模块必须走运行时导入。
  静态说明符会被 webpack 带进 edge 与浏览器产物；生产构建通过不代表开发模式能起来。文件 URL 里的
  反斜杠要换成正斜杠，`file://C:\...` 会被当成主机名。
- 定位：`git grep -n "importRuntimeModule" -- instrumentation.ts lib`。
- 判警：`bun run typecheck` 与 `bun run build` 都可能通过，必须跑 `bun run smoke:dev`。日志里出现
  `Module build failed`、`UnhandledSchemeError`、`Failed to compile` 即失败。

### 5. 移动档判定只有一个来源

- 行为：判定条件是「宽度 ≤ 768px，或 `pointer: coarse` 且宽度 ≤ 1023px」，不看视口高度（软键盘会改
  高度）。界面与 CSS 取同一个常量，改一处就分叉。
- 定位：`git grep -rn "MOBILE_LAYOUT_QUERY" -- lib components hooks`。
- 判警：`lib/mobile-layout.test.mjs` 断言 CSS 与常量逐字一致；`components/MobilePwaLayout.test.mjs`
  断言移动档 CSS 不自带面板头高度。

### 6. 文件浏览默认拒绝允许根之外的路径

- 行为：只放行会话 cwd、其项目根、`~/omp-cwd-*` 与显式放开的目录，其余路径拒绝。根外路径返回 403
  属预期，不是缺陷。
- 定位：`git grep -rn "getAllowedFileRoots" -- lib`；显式放开走
  `git grep -rn "allowFileRoot" -- app lib`。
- 判警：`lib/file-access.test.mjs`。

### 7. 会话浏览只读文件，发消息才建立会话

- 行为：列表与转写只解析 `.jsonl`，浏览时不构造会话对象；发消息时才在进程内建立。转写按分支上的
  全部条目渲染，摘要出现在压缩发生的位置而非开头，压缩前的提问因此仍然占一个圆点与会话地图落点；
  `display.collapseCompacted` 显式开启时才退回 omp 的保留段语义（未配置时网页端取 `false`）。
  工具调用字段差异由统一归一化处理。会话文件头的 `parentSession` 只是显示用元数据，整文件重写是安全的。
- 定位：`git grep -rn "startRpcSession" -- lib app`。
- 判警：`lib/session-reader.test.mjs`、`lib/rpc-manager.test.mjs`。

### 8. 真实模型请求默认关闭

- 行为：不设开关时不发真实请求，会产生费用；需要验证真实链路时先得到用户同意。
- 定位：`git grep -n "OMPDESK_LIVE_SMOKE" -- lib`。
- 判警：不设开关时该用例跳过而不是失败。

## 命令

```bash
bun install
bun run dev        # http://127.0.0.1:30141
bun test           # 用 Bun 跑，不用 node --test
bun run typecheck
bun run ci         # typecheck → test → coverage:gate → build → smoke:dev
bun run verify     # 与 ci 同一份定义
bun run coverage:gate  # 覆盖率门禁：本次改动的覆盖率数字与规则判定，有判定结果时退出码非零
bun run smoke:dev  # 起 dev server，请求 / 与 /api/home，扫描构建失败标记
bun run scratch <任务名> "<用途>"   # 在 .tmp/ 下建任务目录
```

- 开发期间不要执行 `bun run build`：会污染 `.next/` 并打断正在运行的开发服务器。
- `bun test` 的判据是全套零失败。测试一失败，`ci` 里的 build 与冒烟不会执行。
- 依赖本机会话库的用例，本机没有会话时改铺 `test-support/session-fixtures.ts` 的确定性样本；只有会话
  库不可读才跳过。
- `bun run lint` 有存量 error（React 编译器的 memoization 检查，集中在 `components/` 与 `hooks/`），
  所以不在 `ci` 里。判据只看改动文件范围，例如 `bunx eslint test-support lib`。
- 启用了密码锁的机器（`~/.omp/agent/ompdesk-auth.json` 存在）跑冒烟要带
  `OMPDESK_SMOKE_AUTH=用户名:密码`，否则首页固定返回 401，看起来像构建失败。

## 验证阶梯

按改动风险选最深的一层，前一层不能替代后一层：

1. `bun run typecheck` 与 `bun test`。
2. `bun run smoke:dev`：证明开发图谱能编译，首页与一个 API 路由返回 200。
3. 真实浏览器按 `.agents/skills/ompdesk-verify/` 的 `features/` 走一条用户路径，截图与接口状态存到
   `.verify/<时间戳>/`。
4. 涉及移动档时补一次 390×844 复核。
5. 核对副作用本身（新建的会话、写入的文件、打开的标签页）。没有自动检查的不变量到这一步才有结论。

## 代码质量门禁：OCR 审核

合并前必须过一轮机器审核，流程与 `~/.omp/agent/prompts/prompt-ocr-review-merge.md` 一致。审核对象是
`base..head` 的提交差异，不是工作区。

**审核**：每轮新起一个只读子代理，不要复用上一轮结论。子代理先读 `skill://open-code-review`，按其命令跑：

```bash
ocr review --audience agent --format json --from main --to <分支> \
  --background "<这次改动解决什么问题>"
```

结果写到仓库内已忽略的 `.ocr/`（不要用 `/tmp`），读完删除。子代理只审不改，返回清单：路径、行号、
severity、category、问题描述、修改建议；Low 不返回。先用 `ocr review --preview --from main --to <分支>`
确认这次范围：它只收源码扩展名，`.md`（包括 skill 文件）默认不进审核，文档改动要另外人工过一遍。

`ocr review` 因未配置 LLM 失败时，改读 `skill://open-code-review-delegate`，用 `ocr delegate preview` 与
`ocr delegate rule` 取文件与规则后自行审，合并门槛不变。审核规则自动套用 `~/.opencodereview/rule.json`；
仓库还没有 `.opencodereview/rule.json`，要加仓库级规则就放这里。

**修复**：只修 Critical（视同 High）、High、Medium。每条要么改掉，要么判定误报并给出代码证据，不允许用
「影响不大」降级。修完跑 `bun test`、`bun run typecheck` 与改动范围的 eslint，记下命令与结果。

**复审**：推送后重新起一个只读子代理再跑一轮。同一条发现在两轮修复后仍在，停下报告，交用户决定。

**合并**：零 High、零 Medium、CI 通过、无未解决对话、非草稿，才执行 `gh pr merge <编号> --merge`。
合并前把 PR 从草稿转正式，并去掉 `[WIP]` 前缀与 `in-progress` 标签。

**清理**：合并后读 `skill://cleaning-up-worktrees`，用 `wt_audit.py --repo <仓库> --online --plan` 取证据，
只处理这个 PR 的 worktree 与同名分支，顺序是 worktree remove → 本地分支 → 远端分支 → prune。脏 worktree
先把未提交与未跟踪文件列出来，`--force` 需要用户单独同意；同目录下别的分支一条都不动。

## 提交与 PR

- 在独立 worktree 里开发（`.worktrees/<分支名>`），主检出保持干净。
- 提交标题 `type(scope): 中文描述`，`type` 取 `feat`/`fix`/`refactor`/`test`/`docs`/`chore`/`perf`。
- 开发中的 PR 必须同时带草稿状态、`[WIP]` 标题前缀与 `in-progress` 标签；自检与 CI 通过后再撤。
- 合并用 `--merge` 保留历史；合并需要用户明确同意。
