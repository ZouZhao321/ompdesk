# 发版流程

版本号按改动性质递增：功能版本升次版本号，修复版本升修订号。一个开发周期先发一个功能版本，承载本周期确定的功能（约定两个），随后发修复版本把非紧急 bug 一起处理，例如 `1.1.0`、`1.1.1`、`1.2.0`、`1.2.1`。npm、Git 标签与 `package.json` 始终写三段数字；界面与口头说的「1.1」指 `1.1.0`。

改动合并到 `main` 后先记入 `CHANGELOG.md` 的「未发布」段落，决定发版时执行 `scripts/release.ts`，分两步：准备发版 PR，合并后打标签。

## 发版类型与命令

| 类型 | 命令 | 版本变化 | 条件 |
|---|---|---|---|
| 功能版本 | `bun scripts/release.ts feature` | 次版本号加一，修订号归零 | 「未发布」至少一条 `feat` 记录 |
| 定期修复 | `bun scripts/release.ts fix` | 修订号加一 | 本周期已发布至少两条 `feat` 记录，且「未发布」没有 `feat` 记录 |
| 紧急修复 | `bun scripts/release.ts hotfix` | 修订号加一 | 「未发布」没有 `feat` 记录，不受周期限制 |
| 主版本 | `bun scripts/release.ts major` | 大版本号加一，后两段归零 | 不检查记录 |
| 指定版本 | `bun scripts/release.ts <版本>` | 由参数决定 | 按与最新标签的差值判断记录类型，不做周期检查 |

```bash
bun scripts/release.ts status        # 最近版本、本周期功能记录数、下一步建议
bun scripts/release.ts feature       # 1.0.28 -> 1.1.0
bun scripts/release.ts finish 1.1.0  # 发版 PR 合并之后执行
```

两个产物：

- GitHub Release：标签推送后由 `.github/workflows/release.yml` 构建、打成 `ompdesk-<版本>.tgz`，附 `SHA256SUMS.txt`，并用更新记录里这一版的段落做说明。
- npm 包 `ompdesk`：`.github/workflows/publish-npm.yml` 在同一个标签上发布。

## 周期规则

- 一个周期先发一个功能版本，再发一个或多个修复版本；下一个功能版本升次版本号，修订号归零。
- 功能版本承载本周期确定的功能，约定两个，每个功能在「未发布」里写一条 `feat` 记录。
- 修复版本只收非功能改动。定期修复要求本周期已发布至少两条 `feat` 记录，避免功能没发完先发修复；修复版本遇到 `feat` 记录直接拒绝。
- 非紧急 bug 等修复版本一起处理，不插进功能版本。
- 紧急 bug 用 `hotfix`，不打断周期；连续多次紧急修复时修订号依次加一。
- `status` 从本地标签与更新记录推断周期位置，远端发布后先执行 `git fetch --tags`。

## 准备：开一个发版 PR

`bun scripts/release.ts <类型|版本>` 先在本地做检查，全部通过才动手：

- 当前在 `main` 且工作区干净；
- HEAD 不早于 `origin/main`；
- `package.json` 的版本等于最新标签（版本号与标签脱节时先对齐）；
- 目标版本大于最新标签，且本地与远端都没有这个标签；
- `.worktrees/` 已被 Git 忽略；
- 「未发布」段落与发版类型匹配，定期修复还要求本周期已有两条功能记录。

然后：

1. 从 `origin/main` 建工作副本 `.worktrees/chore/release-<版本>` 与同名分支；
2. 把 `package.json` 的版本改成目标版本；
3. 把「未发布」段落转成 `## [<版本>] - <日期>`，并在上面留一个空的「未发布」；
4. 安装依赖（提交钩子要跑类型检查），提交 `chore(release): 发布 v<版本>`；
5. 推送分支并开 PR，正文带上这一版的内容。

命令结束时会打印 PR 地址和下一步要执行的 `finish` 命令。

加 `--dry-run` 只做检查并打印目标版本与发布内容，不建工作副本、不提交、不推送。

## 收口：打标签并发出去

发版 PR 合并、`main` 同步之后执行 `bun scripts/release.ts finish <版本>`。检查项：

- `main`、工作区干净、HEAD 不早于 `origin/main`；
- `package.json` 的版本正是这个版本（发版 PR 已合并）；
- 本地与远端都没有这个标签；
- `CHANGELOG.md` 里有这个版本的段落。

通过后依次执行：

1. 打附注标签 `v<版本>` 并推送；
2. 标签推送触发 `release.yml`：构建、`npm pack` 出 tgz、装进临时项目起服务验证首页、生成校验和、建 GitHub Release 并附上 tgz 与校验和；
3. 盯这个提交上的全部 CI 运行，直到都完成；有失败就打印工作流名与链接并以非零退出。

`release.yml` 的说明文字由 `bun scripts/release.ts notes <版本>` 从 `CHANGELOG.md` 取，CI 与本地用的是同一份解析。

标签推送同时触发 `publish-npm.yml`，因此 `finish` 等待的运行里既有打包也有 npm 发布。

## 版本号约定

- 只接受三段数字，例如 `1.2.1`；带 `v` 会被规范化，带 `-rc.1` 这类后缀直接拒绝（`publish-npm.yml` 发布时不带 `--tag`，预发布号会顶替 `latest`）。
- 必须大于最新标签，也必须等于合并进 `main` 的 `package.json` 版本；两者不一致时脚本在动手之前就停下。
- `feature` 以最新标签的次版本号加一；`fix` 与 `hotfix` 以修订号加一；`major` 以大版本号加一。
- 指定版本号时按与最新标签的差值判断记录类型：次版本变化要求 `feat` 记录，修订号变化拒绝 `feat` 记录，跨大版本不检查。周期数量只在 `fix` 关键字上检查。

## CHANGELOG 写法

「未发布」段落每条一行，格式 `type(scope)：描述（#PR）`。发版时整段搬到新版本标题下，新版本下面重新留一个空的「未发布」。`feat` 记录决定这一版能不能作为功能版本发布。

## 前置条件

- `gh` 已登录，账号能推送分支、建 PR 与 Release。
- npm 上 `ompdesk` 包已存在；`publish-npm.yml` 用可信发布，未配置可信发布者时需要 `NPM_TOKEN`。
- provenance 只对公开仓库生成；仓库保持私有时，`publish-npm.yml` 的 `--provenance` 会让发布失败。

## 失败处理

- 准备阶段失败：脚本在改任何文件之前退出，修好检查项重跑即可。
- 修复版本被周期检查拒绝：先把本周期两个功能发完并各写一条 `feat` 记录；紧急问题改用 `hotfix`；确实要手动指定时写完整版本号。
- `finish` 里 CI 失败：标签已经推出，脚本会打印失败的工作流与链接。修代码走新的 PR 并重新发版；npm 发布失败时在 Actions 里重跑那一次运行，不重复发版本号。
