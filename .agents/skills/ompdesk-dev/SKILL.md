---
name: ompdesk-dev
description: 在本仓库（ompdesk）里开发的入口——代码在哪、改哪类代码要动哪几处、跑什么命令、验证到哪一层、提交与 PR 怎么走。只要任务发生在这个仓库内（改界面、改 API、改会话读取、改模型与凭据、改启动期代码、排障），先读这里再动手；即使只是一句“修个 bug”“加个接口”“页面白屏”，也先按这里的路线定位文件与验证方式，不要从零翻仓库。
---

# ompdesk 开发路线

仓库根用 `git rev-parse --show-toplevel` 确认。完整规范在 `AGENTS.md`，这里只给**路线**：改什么、看哪里、
怎么证明没坏。两处冲突时以 `AGENTS.md` 为准。

## 代码地图

| 位置 | 职责 | 改它时通常还要看 |
|---|---|---|
| `app/api/**/route.ts` | HTTP 入口，多数包在 `withRequestLog` 里 | `lib/rpc-manager.ts`、对应 `*.test.mjs` |
| `lib/rpc-manager.ts` | AgentSession 生命周期、注册表、启动锁 | `lib/omp-runtime.ts` |
| `lib/session-reader.ts` | 读 `.jsonl`、会话列表、上下文重建 | `lib/normalize.ts` |
| `lib/omp-runtime.ts` | 全局 Settings / AuthStorage / ModelRegistry | 凭据与 `models.yml` 的写入方 |
| `components/` | 界面；`AppShell` 负责布局与标签页 | `app/globals.css`、`hooks/` |
| `hooks/` | 流式、SSE、视口、主题等客户端状态 | 对应 `components/` 使用方 |
| `proxy.ts` | Next 的请求前校验：主机允许列表、密码锁 | `bin/web-auth-store.js` |
| `instrumentation.ts` | 进程启动引导：日志、HTTP dispatcher | 只能走运行时导入，见下 |
| `next.config.ts` | distDir 覆盖、SDK 外部化 | `scripts/smoke-dev.mjs` |
| `bin/` | 启动器与密码存储（CommonJS，npm 包里只有它和 `.next`） | `proxy.ts` |
| `app/globals.css` | 两套主题与手机档媒体查询 | `lib/mobile-layout.ts` |

## 按任务走

**加或改 API**：在 `app/api/` 找对应路由，读写逻辑优先复用 `lib/` 里已有函数。会话相关的写入走
`invalidateSessionListCache()`。测试与被测代码同目录，命名 `*.test.mjs`。

两个清点测试会拦住不合规的新路由：`lib/api-route-inventory-read.test.mjs` 要求非 SSE 的 GET 以
`withRequestLog("<由目录推导的模板>", …)` 开头，SSE 路由要进文件里的 `SSE_ROUTES` 名单；
`lib/api-route-inventory-write.test.mjs` 要求 POST/PUT/PATCH/DELETE 同样包装，并维护
`MIN_WRITE_HANDLERS` 下限。路由内部统一前置：拿不准来源时先 `isApiRequestAllowed`（失败 403），
写请求再查 `hasJsonContentType`（失败 415）。`proxy.ts` 的 matcher 已覆盖 `/api/:path*`，
新路由自动继承主机与密码锁校验，不需要改它。

**改界面**：组件在 `components/`，共享状态在 `hooks/`。手机档是一个独立分支：断点定义在
`lib/mobile-layout.ts`（`isMobileLayout()`、`MOBILE_HIT_TARGET_PX = 44`），CSS 里必须同步。
改完必须按下面的验证阶梯跑到浏览器那一层。

**改模型或凭据**：所有写入都要同时调用 `invalidateOmpRuntime()` 与 `invalidateModelsCache()`，否则
会话仍用旧注册表。凭据在 `~/.omp/agent/agent.db`，不经过 `auth.json`。

**改会话读取**：记录顺序跟 omp 的实时聊天记录（`{ transcript: true, collapseCompactedHistory: true }`），
摘要出现在 compaction 的时间位置，不在开头。工具调用字段差异由 `lib/normalize.ts` 统一。

**改启动期代码**（`instrumentation.ts`、`next.config.ts`、`proxy.ts`）：生产构建通过不代表开发模式能起来。
本地加载服务端模块必须用 `importRuntimeModule()` 加运行时 URL，静态可解析的说明符会被 webpack 拖进
edge 与浏览器产物。

## 命令

```bash
bun install
bun run dev        # http://127.0.0.1:30141
bun test           # 用 Bun 跑，不用 node --test
bun run typecheck
bun run ci         # 整条链路：typecheck → test → build → smoke:dev
bun run verify     # 在 ci 之前多一遍 check（typecheck + lint）
bun run smoke:dev  # 起 dev server，请求 / 与 /api/home，扫描构建失败标记
```

- 开发期间不要执行 `bun run build`：会污染 `.next/` 并打断正在运行的开发服务器。
- 启用了密码锁的机器（`~/.omp/agent/ompdesk-auth.json` 存在）跑冒烟要带
  `OMPDESK_SMOKE_AUTH=用户名:密码`，否则首页固定返回 401，看起来像构建失败。
- `bun run lint` 有大量存量告警，不能当门禁；只看改动文件范围的 eslint 结果。
- `bun test` 的判据是全套零失败，不是「失败集合有没有变化」：`bun run ci` 与
  `bun run verify` 都在 typecheck 之后跑测试，测试一挂，build 与冒烟不会执行。
  依赖本机会话库的用例在本机没有会话时改铺 `test-support/session-fixtures.ts` 的
  确定性样本，只有会话库不可读才跳过。

## 验证阶梯

按改动风险选最深的一层，前一层不能替代后一层：

1. `bun run typecheck` 与 `bun test`。
2. `bun run smoke:dev`：证明开发图谱能编译、首页与一个 API 路由返回 200。
3. 真实浏览器按 `.agents/skills/ompdesk-verify/` 的 `features/` 走一条用户路径，截图与接口状态落到
   `.verify/<时间戳>/`。
4. 涉及手机档时补一次 390×844 复核。
5. 有副作用的改动核对副作用本身（新建的会话、写入的文件、打开的面板）。

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

## 坑

- 开发图谱与生产图谱不是同一张：`next build` 绿、`next dev` 500 是真实发生过的事。
- 服务端本地模块用文件 URL 导入时要把反斜杠换成正斜杠，`file://C:\...` 会被当成主机名。
- 手机档断点在 TS 与 CSS 两处，改一处就分叉。
- `/api/files` 只放行会话 cwd、项目根、`~/omp-cwd-*`，默认拒绝其他路径。
- 手机档的文件面板与侧栏都是全屏覆盖层，验证时先关一个再点另一个。
- 会话文件头里的 `parentSession` 只是显示用元数据，整文件重写是安全的。
