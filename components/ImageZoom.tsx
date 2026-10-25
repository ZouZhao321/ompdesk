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
  centerCamera,
  fitZoom,
  isFitCamera,
  panCamera,
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

  const cameraRef = useRef(camera);
  const viewportSizeRef = useRef(viewport);
  const naturalSizeRef = useRef(natural);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const adjustedRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ distance: number; x: number; y: number } | null>(null);

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
    if (image.naturalWidth <= 0) return;
    const size = { w: image.naturalWidth, h: image.naturalHeight };
    const current = naturalSizeRef.current;
    if (current.w === size.w && current.h === size.h) return;
    naturalSizeRef.current = size;
    setNatural(size);
    onNaturalSizeRef.current?.(size);
    // 尺寸与相机同一次更新里就位，避免首帧以 100% 贴在左上角再跳。
    const viewport = viewportSizeRef.current;
    if (!adjustedRef.current && viewport.w > 0 && viewport.h > 0) {
      applyCamera(centerCamera(size, viewport, fitZoom(size, viewport)));
    }
  }, [applyCamera]);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) syncNaturalSize(image);
  }, [src, syncNaturalSize]);

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

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
        const zoomed = zoomCameraAt(
          cameraRef.current,
          { x: midpoint.x - rect.left, y: midpoint.y - rect.top },
          cameraRef.current.scale * (distance / previous.distance),
          image,
          size,
        );
        if (image.w > 0 && zoomed.scale !== cameraRef.current.scale) adjustedRef.current = true;
        applyCamera(
          panCamera(zoomed, midpoint.x - previous.x, midpoint.y - previous.y, image, size),
        );
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
            visibility: natural.w > 0 ? "visible" : "hidden",
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
            imageRendering: camera.scale >= 2 ? "pixelated" : "auto",
          }}
        />
        {loadFailed ? (
          <div className="image-zoom-status is-error">{t("i18n.imageLoadFailed")}</div>
        ) : (
          natural.w <= 0 && <div className="image-zoom-status">{t("i18n.loading")}</div>
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
          className={`image-zoom-action image-zoom-actual${camera.scale === 1 ? " is-active" : ""}`}
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

const noop = () => {};

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
  return useContext(ImagePreviewContext) ?? noop;
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
  const [insideLink, setInsideLink] = useState(false);

  // 图片被 markdown 包在链接里时，可聚焦的应该是那个链接；图片本身不再冒充按钮。
  const attachImage = useCallback((node: HTMLImageElement | null) => {
    setInsideLink(Boolean(node?.closest("a")));
  }, []);

  if (!src) return null;

  const label = alt?.trim() || t("i18n.openImagePreview");
  const open = (event: ReactMouseEvent<HTMLElement> | KeyboardEvent<HTMLImageElement>) => {
    if (event.currentTarget.closest("a")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    openImagePreview({ src, alt: alt?.trim() || undefined });
  };

  if (thumbnail) {
    return (
      <button type="button" className="message-image-button" onClick={open} title={label} aria-label={label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" style={imgStyle} />
      </button>
    );
  }

  const restProps: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown } = { ...imgProps };
  delete restProps.node;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...restProps}
      ref={attachImage}
      src={src}
      alt={alt ?? ""}
      loading={restProps.loading ?? "lazy"}
      className={[restProps.className, className].filter(Boolean).join(" ") || undefined}
      style={imgStyle ?? restProps.style}
      role={insideLink ? undefined : "button"}
      tabIndex={insideLink ? undefined : 0}
      aria-label={insideLink ? undefined : label}
      onClick={open}
      onKeyDown={insideLink ? undefined : (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        open(event);
      }}
    />
  );
}
