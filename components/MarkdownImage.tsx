"use client";

import type { ImgHTMLAttributes } from "react";
import { getFileApiUrl } from "@/lib/file-paths";
import { resolveLocalFileHref } from "@/lib/file-links";
import { ZoomableImage } from "./ImageZoom";

interface MarkdownImageProps {
  src: string;
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
  const localPath = resolveLocalFileHref(src, baseDir, relativeRoot ?? baseDir);
  const imageSrc = localPath ? getFileApiUrl(localPath, "read", sourceSessionId) : src;

  return <ZoomableImage src={imageSrc} alt={alt} className="markdown-image-zoomable" imgProps={imgProps} />;
}
