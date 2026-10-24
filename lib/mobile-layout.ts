/** 与 app/globals.css 移动媒体查询共用的宽度断点。 */
export const MOBILE_MAX_WIDTH = 768;
/** 粗指针设备上判定移动档的高度断点，与 app/globals.css 共用。 */
export const MOBILE_MAX_COARSE_HEIGHT = 480;
/** 移动档可点控件的最小边长（px）。 */
export const MOBILE_HIT_TARGET_PX = 44;

export interface MobileLayoutInput {
  width: number;
  height: number;
  coarsePointer: boolean;
}

/**
 * 判定移动档：宽度不超过断点，或粗指针且视口高度不超过断点。
 * 横屏手机因粗指针与短视口继续留在移动档。
 */
export function isMobileLayout({ width, height, coarsePointer }: MobileLayoutInput): boolean {
  return width <= MOBILE_MAX_WIDTH || (coarsePointer && height <= MOBILE_MAX_COARSE_HEIGHT);
}
