/**
 * 图片缩放的几何计算。
 *
 * 相机模型：图片按原始像素尺寸绘制，再经 `translate(x, y) scale(scale)` 变换，
 * 变换原点在左上角。因此 x、y 是屏幕像素位移，scale 是相对原始像素的比例。
 */

export interface ZoomCamera {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export const IMAGE_ZOOM_MIN = 0.01;
export const IMAGE_ZOOM_MAX = 8;
/** 每次按钮或键盘缩放的倍数。 */
export const IMAGE_ZOOM_STEP = 1.25;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, scale));
}

/** 适配窗口的比例：整张图放进视口，小图不放大超过 100%。 */
export function fitZoom(natural: Size, viewport: Size): number {
  if (natural.w <= 0 || natural.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return 1;
  return clampZoom(Math.min(viewport.w / natural.w, viewport.h / natural.h, 1));
}

/** 平移量的合法范围：图比视口小就居中，比视口大则边缘贴住视口边缘。 */
function clampOffset(offset: number, content: number, extent: number): number {
  if (content <= extent) return (extent - content) / 2;
  return Math.min(0, Math.max(extent - content, offset));
}

export function clampCamera(camera: ZoomCamera, natural: Size, viewport: Size): ZoomCamera {
  if (natural.w <= 0 || natural.h <= 0 || viewport.w <= 0 || viewport.h <= 0) return camera;
  return {
    scale: camera.scale,
    x: clampOffset(camera.x, natural.w * camera.scale, viewport.w),
    y: clampOffset(camera.y, natural.h * camera.scale, viewport.h),
  };
}

export function centerCamera(natural: Size, viewport: Size, scale: number): ZoomCamera {
  const next = clampZoom(scale);
  return clampCamera(
    {
      scale: next,
      x: (viewport.w - natural.w * next) / 2,
      y: (viewport.h - natural.h * next) / 2,
    },
    natural,
    viewport,
  );
}

/** 以视口内某点为锚点缩放：该点下方的图像像素保持不动。 */
export function zoomCameraAt(
  camera: ZoomCamera,
  anchor: { x: number; y: number },
  nextScale: number,
  natural: Size,
  viewport: Size,
): ZoomCamera {
  const next = clampZoom(nextScale);
  if (next === camera.scale || camera.scale <= 0) return camera;
  const ratio = next / camera.scale;
  return clampCamera(
    {
      scale: next,
      x: anchor.x - (anchor.x - camera.x) * ratio,
      y: anchor.y - (anchor.y - camera.y) * ratio,
    },
    natural,
    viewport,
  );
}

export function panCamera(
  camera: ZoomCamera,
  dx: number,
  dy: number,
  natural: Size,
  viewport: Size,
): ZoomCamera {
  return clampCamera(
    { scale: camera.scale, x: camera.x + dx, y: camera.y + dy },
    natural,
    viewport,
  );
}

export interface PinchFrame {
  distance: number;
  x: number;
  y: number;
}

/**
 * 双指捏合：以旧中点为锚缩放，再按中点位移平移。
 * 锚点必须取旧中点，否则中点移动时画面会相对手指漂移。
 */
export function pinchCamera(
  camera: ZoomCamera,
  previous: PinchFrame,
  next: PinchFrame,
  natural: Size,
  viewport: Size,
): ZoomCamera {
  if (previous.distance <= 0) return camera;
  const zoomed = zoomCameraAt(
    camera,
    { x: previous.x, y: previous.y },
    camera.scale * (next.distance / previous.distance),
    natural,
    viewport,
  );
  return panCamera(zoomed, next.x - previous.x, next.y - previous.y, natural, viewport);
}

/** 比例比较的容差：读数取整、按钮高亮与适配判断共用同一阈值。 */
export const ZOOM_SCALE_EPSILON = 0.001;

/** 当前比例是否等于适配比例（用于双击切换与「适配」按钮的按下状态）。 */
export function isFitCamera(camera: ZoomCamera, natural: Size, viewport: Size): boolean {
  return Math.abs(camera.scale - fitZoom(natural, viewport)) < ZOOM_SCALE_EPSILON;
}
