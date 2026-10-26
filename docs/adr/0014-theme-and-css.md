---
name: theme-and-css
description: 主题来自 omp，`globals.css` 只是首屏回退；改配色、字体或主题同步时读。
---

# 主题来自 omp，CSS 只是首屏回退

两套主题是 omp 自己的 `titanium`（默认深色）与 `light`，浏览器与 TUI 因此读起来是同一个产品。`lib/omp-theme.ts` 从 Settings 取 `theme.dark` / `theme.light`，再经 `@oh-my-pi/pi-tui` 的主题解析得出调色板，`/api/theme` 把它发给浏览器。

`app/globals.css` 的静态变量块是首屏回退，运行期会被 `/api/theme` 的结果覆盖，所以改 CSS 里的色值在已加载的页面上看不到效果。变量分两层：`--bg`、`--text`、`--accent` 这类语义变量，以及 `--color-*`（Tailwind 映射）与 `--omp-*`（主题源色）。

`--font-mono` 刻意使用系统字体列表：本地优先的工具不在构建时或运行时从 CDN 拉取字体。
