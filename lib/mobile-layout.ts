/** 与 app/globals.css 移动媒体查询共用的宽度断点。 */
export const MOBILE_MAX_WIDTH = 768;
/**
 * 粗指针分支的宽度上界，与 app/globals.css 共用。
 *
 * 判定只看指针与宽度：视口高度会被软键盘压缩，拿它当条件会让 769–1023px 宽
 * 的触屏设备在聚焦输入框时跳到移动档。宽度不受键盘影响，手机横屏（最宽约
 * 932px）仍在这条上界之内。
 */
export const MOBILE_COARSE_MAX_WIDTH = 1023;
/** 移动档可点控件的最小边长（px）。 */
export const MOBILE_HIT_TARGET_PX = 44;

/**
 * 移动档媒体查询串，CSS 与 useIsMobile 的唯一判定来源。
 *
 * 宽度不超过断点，或粗指针且宽度不超过触屏上界。两个维度都不随软键盘变化，
 * 聚焦输入框不会改写判定。JS 侧直接取这条媒体查询的结果，缩放与聚焦放大只改
 * 视觉视口，不会让 JS 与 CSS 的判定错位。
 */
export const MOBILE_LAYOUT_QUERY =
  `(max-width: ${MOBILE_MAX_WIDTH}px), ` +
  `(pointer: coarse) and (max-width: ${MOBILE_COARSE_MAX_WIDTH}px)`;
