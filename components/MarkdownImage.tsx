"use client";

import type { ImgHTMLAttributes } from "react";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { ZoomableImage } from "./ImageZoom";

interface MarkdownImageProps {
  src: string | Blob | undefined;
  alt?: string;
  /** markdown 图片相对路径的解析基准。 */
  baseDir?: string;
  /** 相对链接回退的根目录，缺省与 baseDir 相同。 */
  relativeRoot?: string;
  sourceSessionId?: string | null;
  imgProps?: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };
}

/** markdown 里的图片：本地路径改走文件接口，其余原样交给 ZoomableImage。 */
export function MarkdownImage({ src, alt, baseDir, relativeRoot, sourceSessionId, imgProps }: MarkdownImageProps) {
  const localPath = typeof src === "string" ? resolveLocalFileHref(src, baseDir, relativeRoot ?? baseDir) : null;
  let imageSrc = src;
  if (localPath) {
    const searchParams = new URLSearchParams({ type: "read" });
    if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
    imageSrc = `/api/files/${encodeFilePathForApi(localPath)}?${searchParams.toString()}`;
  }
  if (typeof imageSrc !== "string") return null;

  return <ZoomableImage src={imageSrc} alt={alt} className="markdown-image-zoomable" imgProps={imgProps} />;
}
