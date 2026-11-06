import type { CSSProperties } from "react";

/**
 * 路径标签左端省略，保留最能说明 checkout 位置的结尾几段。
 * 外层 overflow 负责截断，rtl 容器把省略号放到左边，内层隔离保持路径按
 * 从左到右显示。
 */
export function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}
