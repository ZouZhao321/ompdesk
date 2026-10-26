---
name: mobile-layout-single-source
description: 移动档只有一条媒体查询，粗指针不看高度；改断点或手机命中区时读。
---

# 移动档判定与命中区

移动档只有一个判定来源：`lib/mobile-layout.ts` 的 `MOBILE_LAYOUT_QUERY`，值为 `(max-width: 768px), (pointer: coarse) and (max-width: 1023px)`。宽度阈值来自 `MOBILE_MAX_WIDTH` 与 `MOBILE_COARSE_MAX_WIDTH`；粗指针不看高度，因为软键盘压缩视口会让高度条件在输入过程中翻转档位。

`useIsMobile` 只订阅这条查询：`subscribe` 内创建 `MediaQueryList` 并在退订时移除监听，`getSnapshot` 直接读 `matchMedia(MOBILE_LAYOUT_QUERY).matches`。`app/globals.css` 的手机查询与 `AppShell` 的内联查询都由同一常量拼出，不再手写断点。TSX 尺寸引用 `MOBILE_HIT_TARGET_PX`；CSS 无法导入 TS 常量，手机查询内写等值的 `44px`。

手机档的命中区覆盖顶栏、输入区与扩展浮层、侧栏抽屉、消息操作、页签栏、分支树行与附件删除按钮。`TabBar` 的高度与关闭按钮由组件按 `useIsMobile()` 取值，`globals.css` 不用 `!important` 反压内联尺寸。

## 后果

粗指针且宽度 769–1023px 的设备（竖屏平板）进入移动档；1024px 及以上的横屏平板留在桌面档。
