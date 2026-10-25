/** 与 app/globals.css 移动媒体查询共用的宽度断点。 */
export const MOBILE_MAX_WIDTH = 768;
/** 粗指针设备上判定移动档的高度断点，与 app/globals.css 共用。 */
export const MOBILE_MAX_COARSE_HEIGHT = 480;
/** 移动档可点控件的最小边长（px）。 */
export const MOBILE_HIT_TARGET_PX = 44;

/**
 * 移动档媒体查询串，CSS 与 useIsMobile 的唯一判定来源。
 *
 * 宽度不超过断点，或粗指针且视口高度不超过断点：横屏手机因粗指针与短视口
 * 继续留在移动档。JS 侧直接取这条媒体查询的结果，缩放与聚焦放大只改视觉视口，
 * 不会让 JS 与 CSS 的判定错位。
 */
export const MOBILE_LAYOUT_QUERY =
  `(max-width: ${MOBILE_MAX_WIDTH}px), (pointer: coarse) and (max-height: ${MOBILE_MAX_COARSE_HEIGHT}px)`;
