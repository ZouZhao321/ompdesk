# 右侧文件面板

## Sub-features

- 面板开合与宽度拖拽（桌面档）
- 页签栏：打开多个文件、切换、关闭
- EXPLORER 文件树：展开目录、按名称筛选、刷新、上传
- 变更计数：当前 cwd 的 git 变更文件数
- 手机档：全屏覆盖，关闭按钮在顶栏

## How to get to it (user POV)

桌面档点顶栏右侧的文件面板开关，面板从右边滑出；手机档同一个开关打开的是全屏覆盖面板。

## Driving it with the browser harness

1. 点顶栏的文件面板开关，断言 `#file-panel` 带 `right-panel-open`。
2. 没有打开文件时，`.panel-tab-header` 显示项目名或 `files.explorer` 文案。
3. 在文件树里点一个文件：`.panel-tab-bar` 出现页签，同时内容区渲染文件正文。
4. 关闭页签，断言回到项目名表头。
5. 手机档 390×844：面板是全屏覆盖，关闭后 `#file-panel` 带 `right-panel-closed`。

## Gotchas

- 没有选中的会话或项目时，面板显示 `No file open`，这不是缺陷。
- 文件读取受允许根限制（会话 cwd、其项目根、`~/omp-cwd-*`、显式放开的目录），根外路径返回 403 属预期。
- 手机档侧栏与文件面板都是覆盖层，同时打开会互相遮挡；验证时先关一个。
- 面板在手机上滑出后，页签栏高度与顶栏一致（`.panel-tab-header` 覆盖为 44px 加安全区）。
