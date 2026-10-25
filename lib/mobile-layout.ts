/** 与 app/globals.css 移动媒体查询共用的宽度断点。 */
export const MOBILE_MAX_WIDTH = 768;
/** 粗指针设备上判定移动档的高度断点，与 app/globals.css 共用。 */
export const MOBILE_MAX_COARSE_HEIGHT = 480;
/**
 * 粗指针短视口判定同时要求的宽度上界，与 app/globals.css 共用。
 *
 * 只看高度时，软键盘把视口压短就能把桌面宽度的触屏设备推进移动档。宽度不受
 * 键盘影响，加上这条上界后该分支只跟设备形态走，手机横屏仍在移动档内。
 */
export const MOBILE_COARSE_MAX_WIDTH = 1023;
/** 移动档可点控件的最小边长（px）。 */
export const MOBILE_HIT_TARGET_PX = 44;

/**
 * 移动档媒体查询串，CSS 与 useIsMobile 的唯一判定来源。
 *
 * 宽度不超过断点，或粗指针、宽度不超过触屏上界且视口高度不超过断点：横屏手机
 * 因粗指针与短视口继续留在移动档，软键盘压短视口则不会改写判定。JS 侧直接取
 * 这条媒体查询的结果，缩放与聚焦放大只改视觉视口，不会让 JS 与 CSS 的判定错位。
 */
export const MOBILE_LAYOUT_QUERY =
  `(max-width: ${MOBILE_MAX_WIDTH}px), ` +
  `(pointer: coarse) and (max-width: ${MOBILE_COARSE_MAX_WIDTH}px) ` +
  `and (max-height: ${MOBILE_MAX_COARSE_HEIGHT}px)`;
