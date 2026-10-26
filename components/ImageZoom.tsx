"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  IMAGE_ZOOM_STEP,
  ZOOM_SCALE_EPSILON,
  centerCamera,
  fitZoom,
  isFitCamera,
  panCamera,
  pinchCamera,
  zoomCameraAt,
  type Size,
  type ZoomCamera,
} from "@/lib/image-zoom";

export interface ImagePreviewRequest {
  src: string;
  alt?: string;
}

/** 滚轮每像素位移对应的缩放灵敏度。 */
const IMAGE_WHEEL_SENSITIVITY = 0.0015;

/** 无固有尺寸的图片（如只有 viewBox 的 SVG）退回的替换元素默认尺寸。 */
const DEFAULT_IMAGE_SIZE: Size = { w: 300, h: 150 };

interface ImageZoomSurfaceProps {
  src: string;
  alt?: string;
  className?: string;
  onNaturalSize?: (size: Size) => void;
}

/**
 * 可缩放、可拖动的图片画面。
 * 滚轮对准光标缩放，按住拖动，双击在适配与 1:1 之间切换，键盘 +/-/0/1 同样可用。
 */
export function ImageZoomSurface({ src, alt, className, onNaturalSize }: ImageZoomSurfaceProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ w: 0, h: 0 });
  const [natural, setNatural] = useState<Size>({ w: 0, h: 0 });
  const [camera, setCamera] = useState<ZoomCamera>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const cameraRef = useRef(camera);
  const viewportSizeRef = useRef(viewport);
  const naturalSizeRef = useRef(natural);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const adjustedRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ distance: number; x: number; y: number } | null>(null);
  const previousNaturalRef = useRef<Size | null>(null);

  useEffect(() => {
    viewportSizeRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    naturalSizeRef.current = natural;
  }, [natural]);

  // state 与 ref 必须同步更新，指针事件不等渲染完成就要读到最新相机。
  const applyCamera = useCallback((next: ZoomCamera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);

  const onNaturalSizeRef = useRef(onNaturalSize);
  useEffect(() => {
    onNaturalSizeRef.current = onNaturalSize;
  }, [onNaturalSize]);

  // 缓存命中的图片可能在 onLoad 挂上之前就完成加载，挂载后必须主动核对一次尺寸。
  const syncNaturalSize = useCallback((image: HTMLImageElement) => {
    // 只有 viewBox 的 SVG 在部分引擎里 naturalWidth 为 0，退回元素尺寸与替换元素默认尺寸。
    const hasIntrinsicSize = image.naturalWidth > 0 && image.naturalHeight > 0;
    const size = hasIntrinsicSize
      ? { w: image.naturalWidth, h: image.naturalHeight }
      : { w: image.clientWidth || DEFAULT_IMAGE_SIZE.w, h: image.clientHeight || DEFAULT_IMAGE_SIZE.h };
    const current = naturalSizeRef.current;
    setLoaded(true);
    if (current.w === size.w && current.h === size.h) return;
    naturalSizeRef.current = size;
    setNatural(size);
    if (hasIntrinsicSize) onNaturalSizeRef.current?.(size);
    // 尺寸相近的刷新保留当前比例；换成悬殊的另一张图时重新适配，否则会缩成看不见的大小。
    const previous = previousNaturalRef.current;
    if (previous && previous.w > 0 && previous.h > 0) {
      const ratio = Math.max(
        size.w / previous.w,
        previous.w / size.w,
        size.h / previous.h,
        previous.h / size.h,
      );
      if (ratio > 2) adjustedRef.current = false;
    }
    previousNaturalRef.current = size;
    // 尺寸与相机同一次更新里就位，避免首帧以 100% 贴在左上角再跳。
    const viewport = viewportSizeRef.current;
    if (!adjustedRef.current && viewport.w > 0 && viewport.h > 0) {
      applyCamera(centerCamera(size, viewport, fitZoom(size, viewport)));
    }
  }, [applyCamera]);

  useEffect(() => {
    // 换源（live 刷新或换文件）后先回到加载占位，避免新图按旧尺寸拉伸，也避免失败时留下旧画面。
    if (naturalSizeRef.current.w > 0) previousNaturalRef.current = naturalSizeRef.current;
    naturalSizeRef.current = { w: 0, h: 0 };
    setNatural({ w: 0, h: 0 });
    setLoadFailed(false);
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete) syncNaturalSize(image);
  }, [src, syncNaturalSize]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    let frame = 0;
    let attempts = 0;
    // 关闭状态的 dialog 测到 0×0；等它显示出来再测，不能只靠 ResizeObserver 的下一轮回调。
    const measure = () => {
      const w = element.clientWidth;
      const h = element.clientHeight;
      if (w > 0 && h > 0) {
        setViewport((current) => (current.w === w && current.h === h ? current : { w, h }));
        return;
      }
      if (attempts++ < 120) frame = requestAnimationFrame(measure);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // 首次载入与窗口尺寸变化时回到适配；用户已经手动缩放过的，只把相机拉回合法范围。
  useEffect(() => {
    const image = { w: natural.w, h: natural.h };
    const size = { w: viewport.w, h: viewport.h };
    if (image.w <= 0 || image.h <= 0 || size.w <= 0 || size.h <= 0) return;
    applyCamera(
      adjustedRef.current
        ? panCamera(cameraRef.current, 0, 0, image, size)
        : centerCamera(image, size, fitZoom(image, size)),
    );
  }, [natural.w, natural.h, viewport.w, viewport.h, applyCamera]);

  const zoomTo = useCallback((scale: number, anchor?: { x: number; y: number }) => {
    const size = viewportSizeRef.current;
    const next = zoomCameraAt(
      cameraRef.current,
      anchor ?? { x: size.w / 2, y: size.h / 2 },
      scale,
      naturalSizeRef.current,
      size,
    );
    if (naturalSizeRef.current.w > 0 && next.scale !== cameraRef.current.scale) adjustedRef.current = true;
    applyCamera(next);
  }, [applyCamera]);

  const fitToWindow = useCallback(() => {
    adjustedRef.current = false;
    const size = viewportSizeRef.current;
    const image = naturalSizeRef.current;
    applyCamera(centerCamera(image, size, fitZoom(image, size)));
  }, [applyCamera]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const factor = Math.exp(-event.deltaY * unit * IMAGE_WHEEL_SENSITIVITY);
      zoomTo(cameraRef.current.scale * factor, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };

    // React 的 wheel 监听按 passive 注册，preventDefault 会被忽略，所以直接绑定原生监听。
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1) {
      dragRef.current = { x: event.clientX, y: event.clientY };
      pinchRef.current = null;
      setDragging(true);
      return;
    }

    const [first, second] = [...pointersRef.current.values()];
    pinchRef.current = {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    dragRef.current = null;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2 && pinchRef.current) {
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const previous = pinchRef.current;
      if (previous.distance > 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        const image = naturalSizeRef.current;
        const size = viewportSizeRef.current;
        const next = pinchCamera(
          cameraRef.current,
          { distance: previous.distance, x: previous.x - rect.left, y: previous.y - rect.top },
          { distance, x: midpoint.x - rect.left, y: midpoint.y - rect.top },
          image,
          size,
        );
        if (image.w > 0 && next.scale !== cameraRef.current.scale) adjustedRef.current = true;
        applyCamera(next);
      }
      pinchRef.current = { distance, x: midpoint.x, y: midpoint.y };
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (dx === 0 && dy === 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    const next = panCamera(cameraRef.current, dx, dy, naturalSizeRef.current, viewportSizeRef.current);
    if (naturalSizeRef.current.w > 0 && (next.x !== cameraRef.current.x || next.y !== cameraRef.current.y)) {
      adjustedRef.current = true;
    }
    applyCamera(next);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      pinchRef.current = null;
      setDragging(false);
      return;
    }

    const [remaining] = [...pointersRef.current.values()];
    dragRef.current = { x: remaining.x, y: remaining.y };
    pinchRef.current = null;
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const image = naturalSizeRef.current;
    const size = viewportSizeRef.current;
    if (isFitCamera(cameraRef.current, image, size)) {
      // 小图「适配」就是 100%，再按 1:1 不会有变化，所以切到 200% 才看得出反馈。
      const next = fitZoom(image, size) >= 1 ? Math.min(IMAGE_ZOOM_MAX, 2) : 1;
      zoomTo(next, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      return;
    }
    fitToWindow();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 带修饰键的组合交给浏览器（缩放页面、切换标签页等）。
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(cameraRef.current.scale * IMAGE_ZOOM_STEP);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomTo(cameraRef.current.scale / IMAGE_ZOOM_STEP);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      fitToWindow();
      return;
    }
    if (event.key === "1") {
      event.preventDefault();
      zoomTo(1);
    }
  };

  const fitScale = natural.w > 0 && viewport.w > 0 ? fitZoom(natural, viewport) : 1;
  const atFit = natural.w > 0 && fitScale < 1 && isFitCamera(camera, natural, viewport);
  const percent = Math.round(camera.scale * 100);

  return (
    <div className={["image-zoom", className].filter(Boolean).join(" ")}>
      <div
        ref={viewportRef}
        className={`image-zoom-viewport${dragging ? " is-dragging" : ""}`}
        role="group"
        tabIndex={0}
        aria-label={t("i18n.imageZoomControls")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={alt ?? ""}
          draggable={false}
          className="image-zoom-image"
          onLoad={(event) => syncNaturalSize(event.currentTarget)}
          onError={() => setLoadFailed(true)}
          style={{
            width: natural.w || undefined,
            height: natural.h || undefined,
            visibility: loaded && !loadFailed ? "visible" : "hidden",
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
            imageRendering: camera.scale >= 2 ? "pixelated" : "auto",
          }}
        />
        {loadFailed ? (
          <div className="image-zoom-status is-error">{t("i18n.imageLoadFailed")}</div>
        ) : (
          !loaded && <div className="image-zoom-status">{t("i18n.loading")}</div>
        )}
      </div>
      <div className="image-zoom-controls">
        <button
          type="button"
          className="image-zoom-button"
          onClick={() => zoomTo(camera.scale / IMAGE_ZOOM_STEP)}
          disabled={camera.scale <= IMAGE_ZOOM_MIN}
          title={t("i18n.zoomOut")}
          aria-label={t("i18n.zoomOut")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span className="image-zoom-readout">{percent}%</span>
        <button
          type="button"
          className="image-zoom-button"
          onClick={() => zoomTo(camera.scale * IMAGE_ZOOM_STEP)}
          disabled={camera.scale >= IMAGE_ZOOM_MAX}
          title={t("i18n.zoomIn")}
          aria-label={t("i18n.zoomIn")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className={`image-zoom-action${atFit ? " is-active" : ""}`}
          onClick={fitToWindow}
          title={t("i18n.fitToWindow")}
          aria-label={t("i18n.fitToWindow")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
          </svg>
        </button>
        <button
          type="button"
          className={`image-zoom-action image-zoom-actual${Math.abs(camera.scale - 1) < ZOOM_SCALE_EPSILON ? " is-active" : ""}`}
          onClick={() => zoomTo(1)}
          title={t("i18n.actualSize")}
          aria-label={t("i18n.actualSize")}
        >
          1:1
        </button>
      </div>
    </div>
  );
}

export function ImagePreviewDialog({ request, onClose }: { request: ImagePreviewRequest; onClose: () => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="image-preview-dialog"
      aria-label={t("i18n.imagePreview")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        // 全局 Esc 会中止正在运行的会话；预览层的 Esc 只负责关闭自己。
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <div className="image-preview-bar">
        <span className="image-preview-title">{request.alt || t("i18n.imagePreview")}</span>
        <button
          type="button"
          className="image-preview-close"
          onClick={onClose}
          title={t("i18n.close")}
          aria-label={t("i18n.close")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <ImageZoomSurface src={request.src} alt={request.alt} />
    </dialog>
  );
}

const ImagePreviewContext = createContext<((request: ImagePreviewRequest) => void) | null>(null);

/** 全屏图片预览的挂载点，放在应用根部；聊天里任意图片都能通过 useImagePreview() 打开它。 */
export function ImagePreviewProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ImagePreviewRequest | null>(null);
  const open = useCallback((next: ImagePreviewRequest) => setRequest(next), []);

  return (
    <ImagePreviewContext.Provider value={open}>
      {children}
      {request && (
        <ImagePreviewDialog
          key={request.src}
          request={request}
          onClose={() => setRequest(null)}
        />
      )}
    </ImagePreviewContext.Provider>
  );
}

export function useImagePreview() {
  return useContext(ImagePreviewContext);
}

interface ZoomableImageProps {
  src: string;
  alt?: string;
  className?: string;
  imgStyle?: CSSProperties;
  /** 消息附件用的缩略图模式：外面包一层按钮。 */
  thumbnail?: boolean;
  /** markdown 渲染器剩下的 img 属性（srcSet、style、自定义 class 等）原样转发。 */
  imgProps?: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };
}

/**
 * 点击打开全屏预览的图片。
 * 位于链接内的图片、或按住修饰键时交回浏览器原有行为；行内模式补上键盘可达性。
 */
export function ZoomableImage({ src, alt, className, imgStyle, thumbnail = false, imgProps }: ZoomableImageProps) {
  const { t } = useI18n();
  const openImagePreview = useImagePreview();
  const [insideLink, setInsideLink] = useState<boolean | null>(null);

  // 图片被 markdown 包在链接里时，可聚焦的应该是那个链接；图片本身不再冒充按钮。
  const attachImage = useCallback((node: HTMLImageElement | null) => {
    setInsideLink(Boolean(node?.closest("a")));
  }, []);

  if (!src) return null;

  const clickable = openImagePreview !== null;
  const label = alt?.trim() || t("i18n.openImagePreview");
  const open = (event: ReactMouseEvent<HTMLElement> | KeyboardEvent<HTMLImageElement>) => {
    if (!openImagePreview) return;
    if (event.currentTarget.closest("a")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    openImagePreview({ src, alt: alt?.trim() || undefined });
  };

  if (thumbnail) {
    const thumbnailImage = (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" style={imgStyle} />
    );
    if (!clickable) return thumbnailImage;
    return (
      <button type="button" className="message-image-button" onClick={open} title={label} aria-label={label}>
        {thumbnailImage}
      </button>
    );
  }

  const restProps: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown } = { ...imgProps };
  delete restProps.node;
  // 链接关系只能在挂载后从 DOM 读出，服务端渲染先保持普通图片语义。
  const interactive = clickable && insideLink === false;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...restProps}
      ref={attachImage}
      src={src}
      alt={alt ?? ""}
      loading={restProps.loading ?? "lazy"}
      className={[restProps.className, clickable ? className : undefined].filter(Boolean).join(" ") || undefined}
      style={imgStyle ?? restProps.style}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      onClick={open}
      onKeyDown={interactive ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        open(event);
      } : undefined}
    />
  );
}
