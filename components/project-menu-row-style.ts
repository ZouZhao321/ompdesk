import type { CSSProperties } from "react";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";

/** 项目操作菜单各行的桌面端行高。 */
const DESKTOP_ROW_MIN_HEIGHT_PX = 34;

/**
 * 项目操作菜单里每一行共用的排版：整行可点、统一的左右内边距与小号字。
 * 移动端把行高抬到触控最小边长，桌面端保留各控件原本的高度。
 */
export function projectMenuRowStyle(
  isMobile: boolean,
  desktopMinHeight = DESKTOP_ROW_MIN_HEIGHT_PX,
): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minHeight: isMobile ? MOBILE_HIT_TARGET_PX : desktopMinHeight,
    padding: "0 10px",
    fontSize: 11,
  };
}
